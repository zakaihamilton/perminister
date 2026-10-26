import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { mapWithConcurrency } from "../concurrency";
import { authMutationQueue } from "../mutation-queue";
import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  newConsumerClientId,
  newInvitationId,
  newMembershipId,
  newOrganizationMembershipId,
  type ConsumerClientRecord,
  type MembershipRecord,
  type OrganizationId,
  type OrganizationInvitationRecord,
  type OrganizationMembershipRecord,
  type OrganizationRole,
  type PermissionGrant,
  type ProductRecord,
  type ResourceScope,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { type VersionedRecord } from "../storage/spaces";
import { consumerProductPolicy, consumerRoleActions, scopeResourceId } from "../consumer-policy";
import {
  appendRecordActivityEvent,
  canonicalEmail,
  consumerProductState,
  createAdminProvisionedSubject,
  createPasswordCredential,
  equalHex,
  hashHex,
  invalidateOrganizationDashboardDataCache,
  isEmailVerifiedOrExempt,
  listRecordsWithRecovery,
  mapMembershipsToSubjectContact,
  loadApprovedOrganizationUnlocked,
  loadRecord,
  loadSubjectByEmailUnlocked,
  loadSubjectByUsernameUnlocked,
  loadSubjectUnlocked,
  normalizeProductUsername,
  organizationMembershipUnlocked,
  persistRecord,
  requireOrganizationProductUnlocked,
  requireOrganizationRoleUnlocked,
  requireVerifiedActiveSubject,
  store,
  updateConsumerProductState,
  validateActions,
  validatePassword,
  validateProductId,
  validateScope,
} from "./core";
import {
  type ProductMemberView,
  isActiveSharedInstallationForSource,
  isSharedProductSource,
  requireProductRoleUnlocked,
} from "./organizations-and-products";

const ORGANIZATION_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConsumerClientSummary {
  clientId: string;
  productId: string;
  appName: string;
  appOrigin: string | null;
  sessionLifetimeMs: number;
  selfRegistrationEnabled: boolean;
  status: ConsumerClientRecord["status"];
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface ConsumerClientCredential {
  clientId: string;
  secret: string;
}

export interface CreateConsumerClientOptions {
  appName: string;
  appOrigin: string;
  sessionLifetimeSeconds: number;
  selfRegistrationEnabled: boolean;
}

function consumerClientSummary(record: ConsumerClientRecord): ConsumerClientSummary {
  return {
    clientId: record.consumerClientId,
    productId: record.productId,
    appName: record.appName,
    appOrigin: record.appOrigin,
    sessionLifetimeMs: record.sessionLifetimeMs,
    selfRegistrationEnabled: record.selfRegistrationEnabled,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

async function consumerClientPublisherProductUnlocked(
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
  const reference = product.sharedProductRef;
  if (!reference) return product;

  const publisher = await store().readProduct(
    reference.sourceOrganizationId,
    reference.sourceProductId,
  );
  if (
    !publisher ||
    publisher.sharedProductRef ||
    publisher.productRecordId !== reference.sourceProductRecordId ||
    publisher.productId !== productId ||
    publisher.visibility !== "public"
  ) {
    throw new Error("The product publisher is unavailable.");
  }
  return publisher;
}

async function consumerClientOrganizationsForPublisherUnlocked(
  publisher: ProductRecord,
): Promise<Set<string>> {
  const organizationIds = new Set<string>([publisher.organizationId]);
  if (!isSharedProductSource(publisher)) return organizationIds;

  const products = (await listRecordsWithRecovery("product")).map((entry) => entry.record);
  for (const product of products) {
    if (isActiveSharedInstallationForSource(product, publisher)) {
      organizationIds.add(product.organizationId);
    }
  }
  return organizationIds;
}

async function requireManagedConsumerClientUnlocked(
  organizationId: string,
  productId: string,
  clientId: string,
  requireActive: boolean,
  errorMessage: string,
): Promise<VersionedRecord<ConsumerClientRecord>> {
  const found = await loadRecord("consumer-client", clientId);
  const publisher = await consumerClientPublisherProductUnlocked(organizationId, productId);
  const manageableOrganizations = await consumerClientOrganizationsForPublisherUnlocked(publisher);
  if (
    !found ||
    found.record.productId !== productId ||
    (requireActive && found.record.status !== "active") ||
    !found.record.organizationId ||
    !manageableOrganizations.has(found.record.organizationId)
  ) {
    throw new Error(errorMessage);
  }
  return found;
}

async function requirePublisherManagedConsumerClientProductUnlocked(
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
  if (product.sharedProductRef) {
    throw new Error("App clients are managed by the product publisher.");
  }
  return product;
}

function validateConsumerClientOptions(productId: string, options: CreateConsumerClientOptions) {
  const appName = options.appName.trim().replace(/\s+/g, " ");
  if (!appName || appName.length > 80 || /[\u0000-\u001f\u007f]/.test(appName)) {
    throw new Error("Enter an application name up to 80 characters.");
  }
  let appOrigin: string | null = null;
  const enteredAppOrigin = options.appOrigin.trim();
  if (enteredAppOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(enteredAppOrigin);
    } catch {
      throw new Error("Enter a valid app origin.");
    }
    const isAllowedProtocol =
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
    if (
      !isAllowedProtocol ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        "Use an HTTPS app origin, or an HTTP localhost or 127.0.0.1 origin, without a path, query, or fragment. A portless http://localhost origin allows any localhost port.",
      );
    }
    const rawAuthority = enteredAppOrigin.match(/^http:\/\/([^/?#\\]*)/i)?.[1];
    const explicitPort = rawAuthority?.match(/:(\d+)$/)?.[1];
    const explicitLocalhostPort80 =
      parsed.protocol === "http:" &&
      parsed.hostname === "localhost" &&
      explicitPort !== undefined &&
      Number(explicitPort) === 80;
    appOrigin = explicitLocalhostPort80 ? "http://localhost:80" : parsed.origin;
  }
  if (
    !Number.isSafeInteger(options.sessionLifetimeSeconds) ||
    options.sessionLifetimeSeconds < 5 * 60 ||
    options.sessionLifetimeSeconds > 90 * 24 * 60 * 60
  ) {
    throw new Error("Session lifetime must be between 5 minutes and 90 days.");
  }
  if (typeof options.selfRegistrationEnabled !== "boolean") {
    throw new Error("Choose whether self-registration is enabled.");
  }
  return { appName, appOrigin };
}

export async function getConsumerClientRecord(
  clientId: string,
): Promise<ConsumerClientRecord | null> {
  assertOpaqueId(clientId);
  return authMutationQueue.read(async () => {
    const found = await loadRecord("consumer-client", clientId);
    return found?.record ?? null;
  });
}

export async function listConsumerClientsForProduct(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ConsumerClientSummary[]> {
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.read(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, normalizedProductId, [
      "owner",
      "admin",
    ]);
    const publisher = await consumerClientPublisherProductUnlocked(
      organizationId,
      normalizedProductId,
    );
    const manageableOrganizations =
      await consumerClientOrganizationsForPublisherUnlocked(publisher);
    return (await listRecordsWithRecovery("consumer-client"))
      .map((item) => item.record)
      .filter(
        (record) =>
          record.productId === normalizedProductId &&
          !!record.organizationId &&
          manageableOrganizations.has(record.organizationId),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(consumerClientSummary);
  });
}

async function withConsumerClientManager<Result>(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  operation: (actor: OrganizationMembershipRecord, normalizedProductId: string) => Promise<Result>,
): Promise<Result> {
  assertOpaqueId(organizationId);
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, normalizedProductId, [
        "owner",
        "admin",
      ]);
      await requirePublisherManagedConsumerClientProductUnlocked(
        organizationId,
        normalizedProductId,
      );
      return operation(actor, normalizedProductId);
    }),
  );
}

export async function createConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  options: CreateConsumerClientOptions,
): Promise<ConsumerClientCredential> {
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const validated = validateConsumerClientOptions(normalizedProductId, options);
      const consumerClientId = newConsumerClientId();
      const secret = `pmc_${consumerClientId}_${randomBytes(32).toString("base64url")}`;
      const now = new Date().toISOString();
      const record: ConsumerClientRecord = {
        kind: "consumer-client",
        schemaVersion: 1,
        consumerClientId,
        organizationId: organizationId as OrganizationId,
        productId: normalizedProductId,
        appName: validated.appName,
        appOrigin: validated.appOrigin,
        sessionLifetimeMs: options.sessionLifetimeSeconds * 1000,
        selfRegistrationEnabled: options.selfRegistrationEnabled,
        verifier: { algorithm: "sha256", digestHex: hashHex(secret) },
        status: "active",
        createdBySubjectId: actor.subjectId,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      };
      await persistRecord(record, "consumer-client.created", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return { clientId: consumerClientId, secret };
    },
  );
}

export async function updateConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
  options: CreateConsumerClientOptions,
): Promise<ConsumerClientSummary> {
  assertOpaqueId(clientId);
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const validated = validateConsumerClientOptions(normalizedProductId, options);
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        true,
        "Choose an active application client for this product.",
      );
      const next: ConsumerClientRecord = {
        ...found.record,
        appName: validated.appName,
        appOrigin: validated.appOrigin,
        sessionLifetimeMs: options.sessionLifetimeSeconds * 1000,
        selfRegistrationEnabled: options.selfRegistrationEnabled,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "consumer-client.updated", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return consumerClientSummary(next);
    },
  );
}

export async function rotateConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
): Promise<ConsumerClientCredential> {
  assertOpaqueId(clientId);
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        true,
        "Choose an active application client for this product.",
      );
      const secret = `pmc_${found.record.consumerClientId}_${randomBytes(32).toString("base64url")}`;
      const next: ConsumerClientRecord = {
        ...found.record,
        verifier: { algorithm: "sha256", digestHex: hashHex(secret) },
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "consumer-client.secret-rotated", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return { clientId: next.consumerClientId, secret };
    },
  );
}

export async function revokeConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
): Promise<void> {
  assertOpaqueId(clientId);
  await withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        false,
        "Application client not found.",
      );
      if (found.record.status === "revoked") return;
      const now = new Date().toISOString();
      await persistRecord(
        {
          ...found.record,
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        },
        "consumer-client.revoked",
        { kind: "subject", subjectId: actor.subjectId },
      );
    },
  );
}

export async function listProductMembers(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  options: { includeDisabled?: boolean } = {},
): Promise<ProductMemberView[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner", "admin"]);
    const memberships = (await store().listOrganizationMemberships(organizationId, productId))
      .filter(
        (record) =>
          record.productId === productId && (options.includeDisabled || record.status === "active"),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return mapMembershipsToSubjectContact(memberships);
  });
}

export async function listProductPermissionGrants(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<MembershipRecord[]> {
  return authMutationQueue.run(async () => {
    const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
      "owner",
      "admin",
      "member",
    ]);
    return (await store().listOrganizationMemberships(organizationId, productId))
      .filter((membership) => membership.productId === productId)
      .flatMap((membership) => membership.permissionGrants ?? [])
      .filter(
        (grant) =>
          grant.scope.productId === productId &&
          (actor.role !== "member" || grant.subjectId === actorId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

async function productMemberMutationContextUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: SubjectId,
) {
  const owner = await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner"]);
  const current = await store().readOrganizationMembership(organizationId, subjectId, productId);
  return { owner, current };
}

type ProductMemberMutationContext = Awaited<
  ReturnType<typeof productMemberMutationContextUnlocked>
>;

async function withProductMemberMutation<Result>(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
  operation: (context: ProductMemberMutationContext) => Promise<Result>,
): Promise<Result> {
  assertOpaqueId(subjectId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () =>
      operation(
        await productMemberMutationContextUnlocked(
          actorId,
          organizationId,
          productId,
          subjectId as SubjectId,
        ),
      ),
    ),
  );
}

export async function updateProductMemberRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
  role: OrganizationRole,
): Promise<void> {
  return withProductMemberMutation(
    actorId,
    organizationId,
    productId,
    subjectId,
    async ({ owner, current }) => {
      if (!current || current.status !== "active") throw new Error("Product member not found.");
      if (current.role === role) return;
      const members = await store().listOrganizationMemberships(organizationId, productId);
      const owners = members.filter(
        (membership) =>
          membership.productId === productId &&
          membership.role === "owner" &&
          membership.status === "active",
      );
      if (current.role === "owner" && role !== "owner" && owners.length <= 1) {
        throw new Error("A product must keep at least one owner.");
      }
      await persistRecord(
        { ...current, role, updatedAt: new Date().toISOString() },
        "product.member-role-updated",
        { kind: "subject", subjectId: owner.subjectId },
        { changes: [{ field: "role", before: current.role, after: role }] },
      );
    },
  );
}

export async function removeProductMember(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
): Promise<void> {
  return withProductMemberMutation(
    actorId,
    organizationId,
    productId,
    subjectId,
    async ({ owner, current }) => {
      if (!current) throw new Error("Product member not found.");
      if (current.status === "active" && current.role === "owner") {
        const owners = (
          await store().listOrganizationMemberships(organizationId, productId)
        ).filter(
          (membership) =>
            membership.productId === productId &&
            membership.role === "owner" &&
            membership.status === "active",
        );
        if (owners.length <= 1) throw new Error("A product must keep at least one owner.");
      }
      if (current.status === "active") {
        const now = new Date().toISOString();
        const disabled = {
          ...current,
          status: "disabled" as const,
          permissionGrants: (current.permissionGrants ?? []).map((grant) => ({
            ...grant,
            status: "disabled" as const,
            updatedAt: now,
          })),
          updatedAt: now,
        };
        await persistRecord(disabled, "product.member-removed", {
          kind: "subject",
          subjectId: owner.subjectId,
        });
      }
      const keys = (await listRecordsWithRecovery("api-key"))
        .map((entry) => entry.record)
        .filter(
          (key) =>
            key.owner.kind === "subject" &&
            key.owner.subjectId === subjectId &&
            key.scope.organizationId === organizationId &&
            key.scope.productId === productId &&
            key.status === "active",
        );
      for (const key of keys) {
        await persistRecord(
          { ...key, status: "revoked", revokedAt: new Date().toISOString() },
          "product.member-keys-revoked",
          { kind: "subject", subjectId: owner.subjectId },
        );
      }
    },
  );
}

export interface ConsumerMemberScopeInput {
  organizationId: string;
  productId: string;
  scopeKind: "workspace" | "project";
  resourceId: string;
}

type ConsumerResourceScope = Extract<ResourceScope, { kind: "workspace" | "project" }>;

export interface ConsumerScopedMemberView {
  subjectId: SubjectId;
  email: string | null;
  username: string | null;
  emailVerified: boolean;
  active: boolean;
  role: string;
}

function consumerResourceScope(
  authenticatedProductId: string,
  input: ConsumerMemberScopeInput,
): ConsumerResourceScope {
  const normalizedProductId = validateProductId(authenticatedProductId);
  if (validateProductId(input.productId) !== normalizedProductId) {
    throw new Error("This application does not manage that product.");
  }
  if (!consumerProductPolicy(normalizedProductId)) {
    throw new Error("This application does not manage that resource type.");
  }
  const scope = validateScope(
    input.scopeKind === "workspace"
      ? {
          kind: "workspace",
          organizationId: input.organizationId as OrganizationId,
          productId: normalizedProductId,
          workspaceId: input.resourceId,
        }
      : {
          kind: "project",
          organizationId: input.organizationId as OrganizationId,
          productId: normalizedProductId,
          projectId: input.resourceId,
        },
  );
  if (scope.kind === "product") {
    throw new Error("Choose a workspace or project.");
  }
  return scope;
}

function sameResourceScope(left: ResourceScope, right: ResourceScope): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.productId === right.productId &&
    left.kind === right.kind &&
    scopeResourceId(left) === scopeResourceId(right)
  );
}

function roleGrant(
  authenticatedProductId: string,
  subjectId: SubjectId,
  scope: ResourceScope,
  role: string,
  actions: readonly string[],
  existing?: MembershipRecord,
): MembershipRecord {
  const id = createHash("sha256")
    .update(`${authenticatedProductId}:${scope.kind}:${role}`)
    .digest("hex")
    .slice(0, 32);
  const now = new Date().toISOString();
  return {
    kind: "membership",
    schemaVersion: 1,
    membershipId: existing?.membershipId ?? newMembershipId(),
    subjectId,
    scope,
    grants: [{ scope, actions: [...actions] }],
    accessRole: { id: `role-${id}`, name: role },
    status: "active",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function requireConsumerScopeManagerUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  scope: ResourceScope,
): Promise<OrganizationMembershipRecord> {
  const policy = consumerProductPolicy(authenticatedProductId);
  const actor = await loadSubjectUnlocked(actorId);
  requireVerifiedActiveSubject(actor);
  if (consumerProductState(actor, scope.productId).status !== "active") {
    throw new Error("This account is disabled for the application.");
  }
  if (!policy || !(await loadApprovedOrganizationUnlocked(scope.organizationId))) {
    throw new Error("Resource not found.");
  }
  await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
  const membership = await store().readOrganizationMembership(
    scope.organizationId,
    actorId,
    scope.productId,
  );
  if (
    !membership ||
    membership.status !== "active" ||
    !productMembershipHasPermission(membership, scope, policy.memberManagementAction)
  ) {
    throw new Error("You do not have permission to manage this resource's members.");
  }
  return membership;
}

function hasConsumerPlatformPermission(
  productMembership: OrganizationMembershipRecord,
  action: string,
): boolean {
  const productScope: ResourceScope = {
    kind: "product",
    organizationId: productMembership.organizationId,
    productId: productMembership.productId ?? "",
  };
  return productMembershipHasPermission(productMembership, productScope, action);
}

async function requireConsumerAccountManagerUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  organizationId: string,
  productId: string,
): Promise<OrganizationMembershipRecord> {
  const normalizedProductId = validateProductId(authenticatedProductId);
  if (normalizedProductId !== validateProductId(productId)) {
    throw new Error("This application does not manage that product.");
  }
  const policy = consumerProductPolicy(normalizedProductId);
  if (!policy?.accountManagementAction) {
    throw new Error("This application does not expose global account management.");
  }
  const actor = await loadSubjectUnlocked(actorId);
  requireVerifiedActiveSubject(actor);
  if (consumerProductState(actor, productId).status !== "active") {
    throw new Error("This account is disabled for the application.");
  }
  if (!(await loadApprovedOrganizationUnlocked(organizationId))) {
    throw new Error("Organization not found.");
  }
  await requireOrganizationProductUnlocked(organizationId, productId);
  const membership = await store().readOrganizationMembership(organizationId, actorId, productId);
  if (
    !membership ||
    membership.status !== "active" ||
    !hasConsumerPlatformPermission(membership, policy.accountManagementAction)
  ) {
    throw new Error("Platform administrator access is required.");
  }
  return membership;
}

function consumerMemberGrant(
  membership: OrganizationMembershipRecord,
  scope: ResourceScope,
): MembershipRecord | null {
  return (
    membership.permissionGrants?.find((grant) => sameResourceScope(grant.scope, scope)) ?? null
  );
}

function usernameForProduct(subject: SubjectRecord, productId: string): string | null {
  return (
    subject.loginIdentifiers?.find(
      (identifier) => identifier.kind === "username" && identifier.productId === productId,
    )?.value ?? null
  );
}

export async function listConsumerMembers(
  actorId: SubjectId,
  authenticatedProductId: string,
  input: ConsumerMemberScopeInput,
): Promise<ConsumerScopedMemberView[]> {
  const scope = consumerResourceScope(authenticatedProductId, input);
  return authMutationQueue.run(async () => {
    await requireConsumerScopeManagerUnlocked(actorId, authenticatedProductId, scope);
    const rows = (
      await store().listOrganizationMemberships(scope.organizationId, scope.productId)
    ).filter(
      (membership) =>
        membership.productId === scope.productId &&
        membership.permissionGrants?.some((grant) => sameResourceScope(grant.scope, scope)),
    );
    const members = await mapWithConcurrency(rows, async (membership) => {
      const grant = consumerMemberGrant(membership, scope);
      if (!grant) return null;
      const subject = await loadSubjectUnlocked(membership.subjectId);
      if (!subject) return null;
      return {
        subjectId: subject.subjectId,
        email: subject.primaryEmail,
        username: usernameForProduct(subject, scope.productId),
        emailVerified: !!subject.emailVerifiedAt,
        active:
          subject.status === "active" &&
          consumerProductState(subject, scope.productId).status === "active" &&
          membership.status === "active" &&
          grant.status === "active",
        role: grant.accessRole?.name ?? "",
      } satisfies ConsumerScopedMemberView;
    });
    return members
      .filter((member): member is ConsumerScopedMemberView => member !== null)
      .sort((left, right) =>
        (left.email ?? left.username ?? "").localeCompare(right.email ?? right.username ?? ""),
      );
  });
}

async function findConsumerSubjectUnlocked(
  productId: string,
  emailInput?: string,
  usernameInput?: string,
): Promise<{ subject: SubjectRecord | null; email: string | null; username: string | null }> {
  const email = emailInput === undefined ? null : canonicalEmail(emailInput);
  const username = usernameInput === undefined ? null : normalizeProductUsername(usernameInput);
  const byEmail = email ? await loadSubjectByEmailUnlocked(email) : null;
  const byUsername = username ? await loadSubjectByUsernameUnlocked(productId, username) : null;
  if (byEmail && byUsername && byEmail.subjectId !== byUsername.subjectId) {
    throw new Error("The email and username belong to different accounts.");
  }
  return { subject: byEmail ?? byUsername, email, username };
}

async function ensureConsumerUsernameUnlocked(
  subject: SubjectRecord,
  productId: string,
  username: string,
): Promise<SubjectRecord> {
  const currentUsernameId = await store().findSubjectIdByUsername(productId, username);
  if (currentUsernameId && currentUsernameId !== subject.subjectId) {
    throw new Error("That username is already in use.");
  }
  const current = subject.loginIdentifiers ?? [];
  if (
    current.some(
      (identifier) =>
        identifier.kind === "username" &&
        identifier.productId === productId &&
        identifier.normalizedValue === username,
    )
  ) {
    return subject;
  }
  const next: SubjectRecord = {
    ...subject,
    loginIdentifiers: [
      ...current,
      { kind: "username", productId, value: username, normalizedValue: username },
    ],
    updatedAt: new Date().toISOString(),
  };
  await persistRecord(next, "identity.login-identifier-added", {
    kind: "subject",
    subjectId: subject.subjectId,
  });
  return next;
}

async function ensureConsumerProductMembershipUnlocked(
  subject: SubjectRecord,
  organizationId: string,
  productId: string,
): Promise<OrganizationMembershipRecord> {
  const existing = await store().readOrganizationMembership(
    organizationId,
    subject.subjectId,
    productId,
  );
  if (existing) {
    if (existing.status === "active") return existing;
    const next = { ...existing, status: "active" as const, updatedAt: new Date().toISOString() };
    await persistRecord(next, "product.member-reactivated", {
      kind: "subject",
      subjectId: subject.subjectId,
    });
    return next;
  }
  const now = new Date().toISOString();
  const membership: OrganizationMembershipRecord = {
    kind: "organization-membership",
    schemaVersion: 1,
    organizationMembershipId: newOrganizationMembershipId(),
    organizationId: organizationId as OrganizationId,
    productId,
    subjectId: subject.subjectId,
    role: "member",
    status: "active",
    permissionGrants: [],
    createdAt: now,
    updatedAt: now,
  };
  await persistRecord(
    membership,
    "product.member-added",
    {
      kind: "subject",
      subjectId: subject.subjectId,
    },
    {
      changes: [{ field: "role", before: "None", after: membership.role }],
    },
  );
  return membership;
}

async function setConsumerMemberRoleUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  subjectId: SubjectId,
  scope: ConsumerResourceScope,
  role: string,
  existing?: MembershipRecord,
): Promise<MembershipRecord> {
  const actions = consumerRoleActions(authenticatedProductId, role, scope.kind);
  if (!actions) throw new Error("Choose a role supported by this application.");
  const membership = await store().readOrganizationMembership(
    scope.organizationId,
    subjectId,
    scope.productId,
  );
  if (!membership || membership.status !== "active") {
    throw new Error("The account is not an active member of this product.");
  }
  const grant = roleGrant(authenticatedProductId, subjectId, scope, role, actions, existing);
  await persistRecord(
    grant,
    "consumer.member-role-updated",
    { kind: "subject", subjectId: actorId },
    {
      changes: [
        {
          field: "role",
          before: existing?.accessRole?.name ?? "None",
          after: grant.accessRole?.name ?? role,
        },
      ],
    },
  );
  return grant;
}

async function isConsumerPlatformAdminUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  organizationId: string,
  productId: string,
): Promise<boolean> {
  const policy = consumerProductPolicy(authenticatedProductId);
  if (!policy?.accountManagementAction) return false;
  const membership = await store().readOrganizationMembership(organizationId, actorId, productId);
  return (
    !!membership &&
    membership.status === "active" &&
    hasConsumerPlatformPermission(membership, policy.accountManagementAction)
  );
}

type WorkspaceManagementContext = {
  organizationId: string;
  workspaceId: string;
  productId: string;
  scope: ReturnType<typeof validateScope>;
};

async function withWorkspaceManagement<T>(
  actorId: SubjectId,
  productIdInput: string,
  organizationIdInput: string,
  workspaceIdInput: string,
  operation: (context: WorkspaceManagementContext) => Promise<T>,
): Promise<T> {
  const productId = validateProductId(productIdInput);
  const organizationId = organizationIdInput.trim().toLowerCase();
  const workspaceId = workspaceIdInput.trim().toLowerCase();
  assertOpaqueId(organizationId);
  assertOpaqueId(workspaceId);
  const scope = validateScope({
    kind: "workspace",
    organizationId: organizationId as OrganizationId,
    productId,
    workspaceId,
  });

  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
      await requireOrganizationProductUnlocked(organizationId, productId);
      return operation({ organizationId, workspaceId, productId, scope });
    }),
  );
}

export async function bootstrapWorkspaceAdmin(
  actorId: SubjectId,
  productId: string,
  organizationIdInput: string,
  workspaceIdInput: string,
): Promise<void> {
  await withWorkspaceManagement(
    actorId,
    productId,
    organizationIdInput,
    workspaceIdInput,
    async ({ organizationId, productId, scope }) => {
      const actor = await loadSubjectUnlocked(actorId);
      requireVerifiedActiveSubject(actor);
      if (consumerProductState(actor, productId).status !== "active") {
        throw new Error("This account is disabled for the application.");
      }

      const existingMembership = await store().readOrganizationMembership(
        organizationId,
        actorId,
        productId,
      );
      if (existingMembership?.status === "disabled") {
        throw new Error("This account is disabled for the application.");
      }
      const membership =
        existingMembership ??
        (await ensureConsumerProductMembershipUnlocked(actor, organizationId, productId));
      const actions = consumerRoleActions(productId, "admin", "workspace");
      if (!actions) throw new Error("Workspace administration is unavailable.");
      const currentGrant = consumerMemberGrant(membership, scope);
      const grant = roleGrant(
        productId,
        actorId,
        scope,
        "admin",
        actions,
        currentGrant ?? undefined,
      );
      await persistRecord(grant, "consumer.workspace-admin-bootstrapped", {
        kind: "subject",
        subjectId: actorId,
      });
    },
  );
}

export async function revokeWorkspaceGrants(
  actorId: SubjectId,
  productId: string,
  organizationIdInput: string,
  workspaceIdInput: string,
): Promise<void> {
  await withWorkspaceManagement(
    actorId,
    productId,
    organizationIdInput,
    workspaceIdInput,
    async ({ organizationId, productId, scope }) => {
      const memberships = await store().listOrganizationMemberships(organizationId, productId);
      for (const membership of memberships) {
        if (membership.productId !== productId) continue;
        for (const grant of membership.permissionGrants ?? []) {
          if (!sameResourceScope(grant.scope, scope) || grant.status !== "active") continue;
          await persistRecord(
            { ...grant, status: "disabled", updatedAt: new Date().toISOString() },
            "consumer.workspace-access-revoked",
            { kind: "subject", subjectId: actorId },
          );
        }
      }
    },
  );
}

async function setConsumerPlatformAdminUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  subject: SubjectRecord,
  organizationId: string,
  productId: string,
  enabled: boolean,
): Promise<void> {
  const policy = consumerProductPolicy(authenticatedProductId);
  if (!policy?.accountManagementAction || !policy.platformAdminActions) {
    throw new Error("This application does not expose platform administrator management.");
  }
  const productMembership = await ensureConsumerProductMembershipUnlocked(
    subject,
    organizationId,
    productId,
  );
  const productScope: ResourceScope = {
    kind: "product",
    organizationId: organizationId as OrganizationId,
    productId,
  };
  const currentGrant = consumerMemberGrant(productMembership, productScope);
  if (enabled) {
    const nextGrant = roleGrant(
      authenticatedProductId,
      subject.subjectId,
      productScope,
      "platform-admin",
      policy.platformAdminActions,
      currentGrant ?? undefined,
    );
    await persistRecord(nextGrant, "consumer.platform-admin-enabled", {
      kind: "subject",
      subjectId: actorId,
    });
  } else if (currentGrant?.accessRole?.name === "platform-admin") {
    await persistRecord(
      { ...currentGrant, status: "disabled", updatedAt: new Date().toISOString() },
      "consumer.platform-admin-disabled",
      { kind: "subject", subjectId: actorId },
    );
  }
}

async function isConsumerIdentitySharedAcrossProductsUnlocked(
  subject: SubjectRecord,
  authenticatedProductId: string,
  productId: string,
): Promise<boolean> {
  const normalizedProductId = authenticatedProductId.toLowerCase();
  if (
    subject.loginIdentifiers?.some((identifier) => identifier.productId !== productId) ||
    subject.consumerProductStates?.some((state) => state.productId !== productId) ||
    subject.legacySources?.some((source) => source.source !== normalizedProductId)
  ) {
    return true;
  }
  const productMemberships = await store().listMembershipsForSubject(subject.subjectId);
  return productMemberships.some(
    (membership) => !!membership.productId && membership.productId !== productId,
  );
}

async function protectLastWorkspaceAdminUnlocked(
  targetId: SubjectId,
  scope: ResourceScope,
  currentGrant: MembershipRecord,
  nextRole: string | null,
  nextStatus: "active" | "disabled",
): Promise<void> {
  if (
    scope.kind !== "workspace" ||
    currentGrant.status !== "active" ||
    currentGrant.accessRole?.name !== "admin" ||
    (nextRole === "admin" && nextStatus === "active")
  ) {
    return;
  }
  const memberships = await store().listOrganizationMemberships(
    scope.organizationId,
    scope.productId,
  );
  for (const membership of memberships) {
    const hasActiveAdminGrant =
      membership.productId === scope.productId &&
      membership.status === "active" &&
      membership.permissionGrants?.some(
        (grant) =>
          sameResourceScope(grant.scope, scope) &&
          grant.status === "active" &&
          grant.accessRole?.name === "admin" &&
          grant.subjectId !== targetId,
      );
    if (hasActiveAdminGrant) {
      const subject = await loadSubjectUnlocked(membership.subjectId);
      if (subject?.status === "active") return;
    }
  }
  throw new Error("The workspace must keep an active administrator.");
}

export async function createConsumerMember(
  actorId: SubjectId,
  authenticatedProductId: string,
  input: ConsumerMemberScopeInput & {
    email?: string;
    username?: string;
    password?: string;
    role: string;
  },
): Promise<{ member: ConsumerScopedMemberView; created: boolean }> {
  const scope = consumerResourceScope(authenticatedProductId, input);
  if (!consumerRoleActions(authenticatedProductId, input.role, scope.kind)) {
    throw new Error("Choose a role supported by this application.");
  }
  const email = input.email === undefined ? null : canonicalEmail(input.email);
  const username = input.username === undefined ? null : normalizeProductUsername(input.username);
  if (!email && !username) throw new Error("Provide an email address or username.");
  if (input.password !== undefined) validatePassword(input.password);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actorMembership = await requireConsumerScopeManagerUnlocked(
        actorId,
        authenticatedProductId,
        scope,
      );
      let subject = (
        await findConsumerSubjectUnlocked(input.productId, input.email, input.username)
      ).subject;
      const created = !subject;
      const platformAdmin = await isConsumerPlatformAdminUnlocked(
        actorId,
        authenticatedProductId,
        scope.organizationId,
        scope.productId,
      );
      if (!subject) {
        if (!input.password) throw new Error("Provide an initial password for the new account.");
        if (username && !platformAdmin) {
          throw new Error("A platform administrator must assign the account username.");
        }
        subject = await createAdminProvisionedSubject(
          email,
          input.password,
          actorMembership.subjectId,
        );
      }
      if (
        subject.status !== "active" ||
        consumerProductState(subject, scope.productId).status !== "active"
      ) {
        throw new Error("The account is disabled.");
      }
      if (username) {
        const alreadyLinked = usernameForProduct(subject, input.productId) === username;
        if (!alreadyLinked && !platformAdmin) {
          throw new Error("A platform administrator must assign a new username.");
        }
        subject = await ensureConsumerUsernameUnlocked(subject, input.productId, username);
      }
      await ensureConsumerProductMembershipUnlocked(subject, scope.organizationId, scope.productId);
      const productMembership = await store().readOrganizationMembership(
        scope.organizationId,
        subject.subjectId,
        scope.productId,
      );
      const priorGrant = productMembership ? consumerMemberGrant(productMembership, scope) : null;
      const grant = await setConsumerMemberRoleUnlocked(
        actorMembership.subjectId,
        authenticatedProductId,
        subject.subjectId,
        scope,
        input.role,
        priorGrant ?? undefined,
      );
      return {
        created,
        member: {
          subjectId: subject.subjectId,
          email: subject.primaryEmail,
          username: usernameForProduct(subject, scope.productId),
          emailVerified: !!subject.emailVerifiedAt,
          active: subject.status === "active" && grant.status === "active",
          role: grant.accessRole?.name ?? input.role,
        },
      };
    }),
  );
}

export async function updateConsumerMember(
  actorId: SubjectId,
  authenticatedProductId: string,
  subjectIdInput: string,
  input: ConsumerMemberScopeInput & {
    role?: string;
    status?: "active" | "disabled";
    password?: string;
  },
): Promise<void> {
  assertOpaqueId(subjectIdInput);
  const subjectId = subjectIdInput as SubjectId;
  const scope = consumerResourceScope(authenticatedProductId, input);
  if (
    input.role !== undefined &&
    !consumerRoleActions(authenticatedProductId, input.role, scope.kind)
  ) {
    throw new Error("Choose a role supported by this application.");
  }
  if (input.status === undefined && input.role === undefined && input.password === undefined) {
    throw new Error("Provide a role, status, or password change.");
  }
  if (input.password !== undefined) validatePassword(input.password);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      await requireConsumerScopeManagerUnlocked(actorId, authenticatedProductId, scope);
      const platformAdmin = await isConsumerPlatformAdminUnlocked(
        actorId,
        authenticatedProductId,
        scope.organizationId,
        scope.productId,
      );
      if (actorId === subjectId && !platformAdmin) {
        throw new Error("Ask another administrator to change your account.");
      }
      const productMembership = await store().readOrganizationMembership(
        scope.organizationId,
        subjectId,
        scope.productId,
      );
      const currentGrant = productMembership ? consumerMemberGrant(productMembership, scope) : null;
      if (!productMembership || !currentGrant) throw new Error("Member not found.");
      const subject = input.password === undefined ? null : await loadSubjectUnlocked(subjectId);
      if (input.password !== undefined && (!subject || subject.status !== "active")) {
        throw new Error("Member not found.");
      }
      if (
        subject &&
        (await isConsumerIdentitySharedAcrossProductsUnlocked(
          subject,
          authenticatedProductId,
          scope.productId,
        ))
      ) {
        throw new Error(
          "An administrator cannot reset shared credentials across products; the account owner must.",
        );
      }
      const nextRole = input.role ?? currentGrant.accessRole?.name ?? null;
      const nextStatus = input.status ?? currentGrant.status;
      await protectLastWorkspaceAdminUnlocked(subjectId, scope, currentGrant, nextRole, nextStatus);
      let nextGrant = currentGrant;
      if (input.status === "active" && productMembership.status !== "active") {
        await persistRecord(
          { ...productMembership, status: "active", updatedAt: new Date().toISOString() },
          "product.member-reactivated",
          { kind: "subject", subjectId: actorId },
        );
      }
      if (input.role !== undefined) {
        nextGrant = await setConsumerMemberRoleUnlocked(
          actorId,
          authenticatedProductId,
          subjectId,
          scope,
          input.role,
          currentGrant,
        );
      }
      if (input.status !== undefined && input.status !== nextGrant.status) {
        await persistRecord(
          { ...nextGrant, status: input.status, updatedAt: new Date().toISOString() },
          input.status === "disabled" ? "consumer.member-disabled" : "consumer.member-enabled",
          { kind: "subject", subjectId: actorId },
        );
      }
      if (input.password !== undefined) {
        await persistRecord(
          {
            ...subject!,
            passwordCredential: await createPasswordCredential(input.password),
            authVersion: subject!.authVersion + 1,
            updatedAt: new Date().toISOString(),
          },
          "credential.admin-reset",
          { kind: "subject", subjectId: actorId },
        );
      }
      const updatedMembership = await store().readOrganizationMembership(
        scope.organizationId,
        subjectId,
        scope.productId,
      );
      if (updatedMembership && updatedMembership.role !== "owner") {
        const hasActiveGrant = (updatedMembership.permissionGrants ?? []).some(
          (grant) => grant.status === "active",
        );
        const nextMembershipStatus = hasActiveGrant ? "active" : "disabled";
        if (updatedMembership.status !== nextMembershipStatus) {
          await persistRecord(
            {
              ...updatedMembership,
              status: nextMembershipStatus,
              updatedAt: new Date().toISOString(),
            },
            nextMembershipStatus === "active"
              ? "product.member-reactivated"
              : "product.member-removed",
            { kind: "subject", subjectId: actorId },
          );
        }
      }
    }),
  );
}

export async function removeConsumerMember(
  actorId: SubjectId,
  authenticatedProductId: string,
  subjectId: string,
  input: ConsumerMemberScopeInput,
): Promise<void> {
  return updateConsumerMember(actorId, authenticatedProductId, subjectId, {
    ...input,
    status: "disabled",
  });
}

export interface ConsumerAccountView {
  subjectId: SubjectId;
  email: string | null;
  username: string;
  status: "active" | "disabled";
  platformAdmin: boolean;
}

export async function listConsumerAccounts(
  actorId: SubjectId,
  authenticatedProductId: string,
  organizationId: string,
  productId: string,
): Promise<ConsumerAccountView[]> {
  if (validateProductId(authenticatedProductId) !== validateProductId(productId)) {
    throw new Error("This application does not manage that product.");
  }
  return authMutationQueue.run(async () => {
    await requireConsumerAccountManagerUnlocked(
      actorId,
      authenticatedProductId,
      organizationId,
      productId,
    );
    const policy = consumerProductPolicy(authenticatedProductId)!;
    const subjects = (await listRecordsWithRecovery("subject")).map((item) => item.record);
    const organizationMemberships = await store().listOrganizationMemberships(
      organizationId,
      productId,
    );
    const membershipsBySubject = new Map(
      organizationMemberships
        .filter((membership) => membership.productId === productId)
        .map((membership) => [membership.subjectId, membership]),
    );
    const result: ConsumerAccountView[] = [];
    for (const subject of subjects) {
      const username = usernameForProduct(subject, productId);
      const membership = membershipsBySubject.get(subject.subjectId);
      if (!username || !membership) continue;
      result.push({
        subjectId: subject.subjectId,
        email: subject.primaryEmail,
        username,
        status: consumerProductState(subject, productId).status,
        platformAdmin: hasConsumerPlatformPermission(membership, policy.accountManagementAction),
      });
    }
    return result.sort((left, right) => left.username.localeCompare(right.username));
  });
}

export async function createConsumerAccount(
  actorId: SubjectId,
  authenticatedProductId: string,
  input: {
    organizationId: string;
    productId: string;
    username: string;
    email?: string;
    password: string;
    platformAdmin?: boolean;
  },
): Promise<{ account: ConsumerAccountView; created: boolean }> {
  if (validateProductId(authenticatedProductId) !== validateProductId(input.productId)) {
    throw new Error("This application does not manage that product.");
  }
  const policy = consumerProductPolicy(validateProductId(authenticatedProductId));
  if (!policy?.accountManagementAction) {
    throw new Error("This application does not expose global account provisioning.");
  }
  const accountManagementAction = policy.accountManagementAction;
  const username = normalizeProductUsername(input.username);
  const email = input.email === undefined ? null : canonicalEmail(input.email);
  validatePassword(input.password);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(input.organizationId, async () => {
      await requireConsumerAccountManagerUnlocked(
        actorId,
        authenticatedProductId,
        input.organizationId,
        input.productId,
      );
      const byUsername = await loadSubjectByUsernameUnlocked(input.productId, username);
      const byEmail = email ? await loadSubjectByEmailUnlocked(email) : null;
      if (byUsername && byEmail && byUsername.subjectId !== byEmail.subjectId) {
        throw new Error("The email and username belong to different accounts.");
      }
      let subject = byEmail ?? byUsername;
      const created = !subject;
      if (!subject) {
        subject = await createAdminProvisionedSubject(email, input.password, actorId);
      }
      if (
        subject.status !== "active" ||
        consumerProductState(subject, input.productId).status !== "active"
      ) {
        throw new Error("The account is disabled.");
      }
      subject = await ensureConsumerUsernameUnlocked(subject, input.productId, username);
      await ensureConsumerProductMembershipUnlocked(subject, input.organizationId, input.productId);
      if (input.platformAdmin === true) {
        await setConsumerPlatformAdminUnlocked(
          actorId,
          authenticatedProductId,
          subject,
          input.organizationId,
          input.productId,
          true,
        );
      }
      const updatedMembership = await store().readOrganizationMembership(
        input.organizationId,
        subject.subjectId,
        input.productId,
      );
      const hasPlatformRole =
        !!updatedMembership &&
        hasConsumerPlatformPermission(updatedMembership, accountManagementAction);
      return {
        created,
        account: {
          subjectId: subject.subjectId,
          email: subject.primaryEmail,
          username,
          status: consumerProductState(subject, input.productId).status,
          platformAdmin: hasPlatformRole,
        },
      };
    }),
  );
}

export async function updateConsumerAccount(
  actorId: SubjectId,
  authenticatedProductId: string,
  subjectIdInput: string,
  input: {
    organizationId: string;
    productId: string;
    status?: "active" | "disabled";
    password?: string;
    revokeSessions?: boolean;
    platformAdmin?: boolean;
  },
): Promise<void> {
  assertOpaqueId(subjectIdInput);
  if (validateProductId(authenticatedProductId) !== validateProductId(input.productId)) {
    throw new Error("This application does not manage that product.");
  }
  if (actorId === subjectIdInput) throw new Error("You cannot change your own account here.");
  if (
    input.status === undefined &&
    input.password === undefined &&
    !input.revokeSessions &&
    input.platformAdmin === undefined
  ) {
    throw new Error("Provide a status, password, platform role, or session revocation change.");
  }
  if (input.password !== undefined) validatePassword(input.password);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(input.organizationId, async () => {
      await requireConsumerAccountManagerUnlocked(
        actorId,
        authenticatedProductId,
        input.organizationId,
        input.productId,
      );
      const current = await loadSubjectUnlocked(subjectIdInput);
      const organizationMembership = await store().readOrganizationMembership(
        input.organizationId,
        subjectIdInput as SubjectId,
        input.productId,
      );
      if (!current || !usernameForProduct(current, input.productId) || !organizationMembership) {
        throw new Error("Account not found.");
      }
      const currentProductState = consumerProductState(current, input.productId);
      if (
        input.password !== undefined &&
        (await isConsumerIdentitySharedAcrossProductsUnlocked(
          current,
          authenticatedProductId,
          input.productId,
        ))
      ) {
        throw new Error(
          "An administrator cannot reset shared credentials across products; the account owner must.",
        );
      }
      if (input.platformAdmin !== undefined) {
        await setConsumerPlatformAdminUnlocked(
          actorId,
          authenticatedProductId,
          current,
          input.organizationId,
          input.productId,
          input.platformAdmin,
        );
      }
      const nextStatus = input.status ?? currentProductState.status;
      const statusChanged = nextStatus !== currentProductState.status;
      const nextCredential = input.password
        ? await createPasswordCredential(input.password)
        : current.passwordCredential;
      if (!statusChanged && !input.password && !input.revokeSessions) {
        return;
      }
      const consumerProductStates =
        statusChanged || input.revokeSessions
          ? updateConsumerProductState(current, input.productId, nextStatus, input.revokeSessions)
          : current.consumerProductStates;
      await persistRecord(
        {
          ...current,
          consumerProductStates,
          passwordCredential: nextCredential,
          authVersion: current.authVersion + (input.password ? 1 : 0),
          updatedAt: new Date().toISOString(),
        },
        input.password
          ? "credential.admin-reset"
          : input.revokeSessions
            ? "session.account-revoked"
            : nextStatus === "disabled"
              ? "consumer.account-disabled"
              : "consumer.account-enabled",
        { kind: "subject", subjectId: actorId },
      );
    }),
  );
}

function createInvitationDraft(
  actorId: SubjectId,
  organizationId: string,
  email: string,
  role: OrganizationInvitationRecord["role"],
  productId?: string,
): { invitation: OrganizationInvitationRecord; token: string } {
  const invitationId = newInvitationId();
  const token = `${invitationId}.${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  return {
    token,
    invitation: {
      kind: "organization-invitation",
      schemaVersion: 1,
      invitationId,
      organizationId: organizationId as OrganizationId,
      ...(productId ? { productId } : {}),
      email,
      role,
      verifierDigestHex: hashHex(token),
      createdBySubjectId: actorId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ORGANIZATION_INVITATION_LIFETIME_MS).toISOString(),
      consumedAt: null,
      revokedAt: null,
    },
  };
}

function activeInvitationsForScope(
  invitations: OrganizationInvitationRecord[],
  organizationId: string,
  productId?: string,
): OrganizationInvitationRecord[] {
  return invitations
    .filter(
      (invite) =>
        invite.organizationId === organizationId &&
        (productId === undefined ? !invite.productId : invite.productId === productId) &&
        !invite.consumedAt &&
        !invite.revokedAt &&
        Date.parse(invite.expiresAt) > Date.now(),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createOrganizationInvitation(
  actorId: SubjectId,
  organizationId: string,
  emailInput: string,
  role: "admin",
): Promise<{ invitation: OrganizationInvitationRecord; token: string; organizationName: string }> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      if (actorMembership.role !== "owner") {
        throw new Error("Only an organization owner can invite an administrator.");
      }
      const organization = await loadRecord("organization", organizationId);
      if (!organization) throw new Error("Organization not found.");
      const target = await loadSubjectByEmailUnlocked(email);
      if (target && (await organizationMembershipUnlocked(organizationId, target.subjectId))) {
        throw new Error("This person is already a catalog manager.");
      }
      const invites = (await listRecordsWithRecovery("organization-invitation")).map(
        (item) => item.record,
      );
      for (const previous of invites.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.email === email &&
          !item.consumedAt &&
          !item.revokedAt,
      )) {
        await persistRecord(
          { ...previous, revokedAt: new Date().toISOString() },
          "organization.invitation-replaced",
          { kind: "subject", subjectId: actorId },
        );
      }
      const { invitation, token } = createInvitationDraft(actorId, organizationId, email, role);
      await persistRecord(
        invitation,
        "organization.invitation-created",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
        },
      );
      return { invitation, token, organizationName: organization.record.name };
    }),
  );
}

export async function prepareOrganizationInvitationResend(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
): Promise<{ invitation: OrganizationInvitationRecord; token: string; organizationName: string }> {
  assertOpaqueId(invitationId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (
        !current ||
        current.record.organizationId !== organizationId ||
        current.record.productId ||
        current.record.consumedAt ||
        current.record.revokedAt ||
        Date.parse(current.record.expiresAt) <= Date.now()
      ) {
        throw new Error("Invitation not found.");
      }

      const organization = await loadRecord("organization", organizationId);
      if (!organization) throw new Error("Organization not found.");
      const target = await loadSubjectByEmailUnlocked(current.record.email);
      if (target && (await organizationMembershipUnlocked(organizationId, target.subjectId))) {
        throw new Error("This person is already a catalog manager.");
      }

      const { invitation, token } = createInvitationDraft(
        actorMembership.subjectId,
        organizationId,
        current.record.email,
        current.record.role,
      );
      await persistRecord(
        invitation,
        "organization.invitation-created",
        { kind: "subject", subjectId: actorMembership.subjectId },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
          resendOfInvitationId: current.record.invitationId,
        },
      );
      return { invitation, token, organizationName: organization.record.name };
    }),
  );
}

export async function completeOrganizationInvitationResend(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
  resentInvitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  assertOpaqueId(resentInvitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
      ]);
      const resent = await loadRecord("organization-invitation", resentInvitationId);
      const previous = await loadRecord("organization-invitation", invitationId);
      if (
        !resent ||
        resent.record.organizationId !== organizationId ||
        resent.record.productId ||
        resent.record.createdBySubjectId !== actorMembership.subjectId ||
        resent.record.consumedAt ||
        resent.record.revokedAt ||
        Date.parse(resent.record.expiresAt) <= Date.now()
      ) {
        throw new Error("Invitation not found.");
      }
      if (
        !previous ||
        previous.record.organizationId !== organizationId ||
        previous.record.productId ||
        previous.record.email !== resent.record.email
      ) {
        throw new Error("Invitation not found.");
      }

      const invites = (await listRecordsWithRecovery("organization-invitation")).map(
        (item) => item.record,
      );
      for (const previous of invites.filter(
        (item) =>
          item.organizationId === organizationId &&
          !item.productId &&
          item.email === resent.record.email &&
          item.invitationId !== resentInvitationId &&
          !item.consumedAt &&
          !item.revokedAt,
      )) {
        await persistRecord(
          { ...previous, revokedAt: new Date().toISOString() },
          "organization.invitation-replaced",
          { kind: "subject", subjectId: actorMembership.subjectId },
        );
      }
    }),
  );
}

export async function createProductInvitation(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  emailInput: string,
  role: "admin" | "member",
): Promise<{ invitation: OrganizationInvitationRecord; token: string; productName: string }> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      if (role === "admin" && actor.role !== "owner") {
        throw new Error("Only a product owner can invite a product administrator.");
      }
      const product = await store().readProduct(organizationId, productId);
      if (!product) throw new Error("Product not found.");
      const target = await loadSubjectByEmailUnlocked(email);
      if (target) {
        const existing = await store().readOrganizationMembership(
          organizationId,
          target.subjectId,
          productId,
        );
        if (existing?.status === "active")
          throw new Error("This person is already a product member.");
      }
      const invitations = (await listRecordsWithRecovery("organization-invitation"))
        .map((entry) => entry.record)
        .filter(
          (invite) =>
            invite.organizationId === organizationId &&
            invite.productId === productId &&
            invite.email === email &&
            !invite.consumedAt &&
            !invite.revokedAt,
        );
      for (const previous of invitations) {
        await persistRecord(
          { ...previous, revokedAt: new Date().toISOString() },
          "product.invitation-replaced",
          { kind: "subject", subjectId: actorId },
        );
      }
      const { invitation, token } = createInvitationDraft(
        actorId,
        organizationId,
        email,
        role,
        productId,
      );
      await persistRecord(
        invitation,
        "product.invitation-created",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
        },
      );
      return { invitation, token, productName: product.name };
    }),
  );
}

export async function listOrganizationInvitations(
  actorId: SubjectId,
  organizationId: string,
): Promise<OrganizationInvitationRecord[]> {
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const invitations = (await listRecordsWithRecovery("organization-invitation")).map(
      (item) => item.record,
    );
    return activeInvitationsForScope(invitations, organizationId);
  });
}

export async function listProductInvitations(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<OrganizationInvitationRecord[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner", "admin"]);
    const invitations = (await listRecordsWithRecovery("organization-invitation")).map(
      (item) => item.record,
    );
    return activeInvitationsForScope(invitations, organizationId, productId);
  });
}

export async function revokeOrganizationInvitation(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (!current || current.record.organizationId !== organizationId)
        throw new Error("Invitation not found.");
      if (current.record.productId) throw new Error("Invitation not found.");
      if (current.record.consumedAt || current.record.revokedAt) return;
      await persistRecord(
        { ...current.record, revokedAt: new Date().toISOString() },
        "organization.invitation-revoked",
        { kind: "subject", subjectId: actorMembership.subjectId },
      );
    }),
  );
}

export async function revokeProductInvitation(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  invitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (
        !current ||
        current.record.organizationId !== organizationId ||
        current.record.productId !== productId
      ) {
        throw new Error("Invitation not found.");
      }
      if (current.record.consumedAt || current.record.revokedAt) return;
      await persistRecord(
        { ...current.record, revokedAt: new Date().toISOString() },
        "product.invitation-revoked",
        { kind: "subject", subjectId: actor.subjectId },
      );
    }),
  );
}

export async function acceptOrganizationInvitation(
  subjectId: SubjectId,
  token: string,
): Promise<OrganizationId> {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(token);
  if (!match) throw new Error("This invitation is invalid or expired.");
  assertOpaqueId(match[1]);
  return authMutationQueue.run(async () => {
    const initial = await loadRecord("organization-invitation", match[1]);
    if (!initial) throw new Error("This invitation is invalid or expired.");
    return withOrganizationMutationLock(initial.record.organizationId, async () => {
      const subject = await loadSubjectUnlocked(subjectId);
      if (!subject || subject.status !== "active" || !subject.primaryEmail)
        throw new Error("An active account is required to accept an invitation.");
      const current = await loadRecord("organization-invitation", match[1]);
      if (
        !current ||
        current.record.consumedAt ||
        current.record.revokedAt ||
        Date.parse(current.record.expiresAt) <= Date.now() ||
        current.record.email !== subject.primaryEmail.toLowerCase() ||
        !equalHex(current.record.verifierDigestHex, hashHex(token))
      ) {
        throw new Error(
          "This invitation is invalid or expired, or it was sent to another email address.",
        );
      }
      if (!(await loadApprovedOrganizationUnlocked(current.record.organizationId))) {
        throw new Error(
          "This invitation is invalid or expired, or it was sent to another email address.",
        );
      }
      const existing = await store().readOrganizationMembership(
        current.record.organizationId,
        subjectId,
        current.record.productId,
      );
      if (!existing || existing.status !== "active") {
        const now = new Date().toISOString();
        const membership: OrganizationMembershipRecord = existing
          ? {
              ...existing,
              ...(current.record.productId
                ? {
                    productId: current.record.productId,
                    permissionGrants: existing.permissionGrants ?? [],
                  }
                : {}),
              role: current.record.productId ? current.record.role : "admin",
              status: "active",
              updatedAt: now,
            }
          : {
              kind: "organization-membership",
              schemaVersion: 1,
              organizationMembershipId: newOrganizationMembershipId(),
              organizationId: current.record.organizationId,
              ...(current.record.productId
                ? { productId: current.record.productId, permissionGrants: [] }
                : {}),
              subjectId,
              role: current.record.productId ? current.record.role : "admin",
              status: "active",
              createdAt: now,
              updatedAt: now,
            };
        await persistRecord(
          membership,
          current.record.productId
            ? "product.invitation-accepted"
            : "organization.catalog-manager-invitation-accepted",
          {
            kind: "subject",
            subjectId,
          },
        );
      }
      if (!subject.emailVerifiedAt) {
        await persistRecord(
          {
            ...subject,
            emailVerifiedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "identity.email-verified-by-invitation",
          { kind: "subject", subjectId },
        );
      }
      await persistRecord(
        { ...current.record, consumedAt: new Date().toISOString() },
        "organization.invitation-consumed",
        { kind: "subject", subjectId },
      );
      return current.record.organizationId;
    });
  });
}

export const listOrganizationPermissionGrants = cache(
  async function listOrganizationPermissionGrants(
    subjectId: SubjectId,
    organizationId: string,
  ): Promise<MembershipRecord[]> {
    return authMutationQueue.read(async () => {
      const catalogManager = await organizationMembershipUnlocked(organizationId, subjectId);
      let memberships: OrganizationMembershipRecord[];
      if (!catalogManager) {
        memberships = await store().listMembershipsForSubject(subjectId);
        if (
          !memberships.some(
            (item) =>
              item.organizationId === organizationId && item.productId && item.status === "active",
          )
        ) {
          throw new Error("Organization not found.");
        }
        memberships = memberships.filter(
          (membership) => membership.organizationId === organizationId && !!membership.productId,
        );
      } else {
        memberships = await store().listOrganizationMemberships(organizationId);
      }
      const isCatalogManager = !!catalogManager;
      return memberships
        .filter((membership) => !!membership.productId)
        .flatMap((membership) => membership.permissionGrants ?? [])
        .filter(
          (record) =>
            record.scope.organizationId === organizationId &&
            (isCatalogManager || record.subjectId === subjectId),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    });
  },
);

export async function createPermissionGrant(
  actorId: SubjectId,
  targetSubjectId: string,
  scopeInput: ResourceScope,
  actionsInput: readonly string[],
  accessRoleIdInput?: string,
): Promise<MembershipRecord> {
  assertOpaqueId(targetSubjectId);
  const scope = validateScope(scopeInput);
  const accessRoleId = accessRoleIdInput?.trim();
  if (accessRoleId && !/^role-[0-9a-f]{32}$/.test(accessRoleId)) {
    throw new Error("Choose a valid product access role.");
  }
  const customActions = accessRoleId ? null : validateActions(actionsInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actorMembership = await requireProductRoleUnlocked(
        actorId,
        scope.organizationId,
        scope.productId,
        ["owner", "admin"],
      );
      const product = await store().readProduct(scope.organizationId, scope.productId);
      if (!product) throw new Error("Choose a product in this organization.");
      const role = accessRoleId
        ? product.accessRoles?.find((item) => item.id === accessRoleId)
        : undefined;
      if (accessRoleId && !role) {
        throw new Error("Choose an access role configured for this product.");
      }
      const actions = role ? validateActions(role.actions) : customActions;
      if (!actions) throw new Error("Enter 1 to 32 valid action names.");
      const target = await loadSubjectUnlocked(targetSubjectId);
      if (!target || target.status !== "active" || !isEmailVerifiedOrExempt(target)) {
        throw new Error("Choose an active, email-verified account.");
      }
      const targetMembership = await store().readOrganizationMembership(
        scope.organizationId,
        targetSubjectId as SubjectId,
        scope.productId,
      );
      if (!targetMembership || targetMembership.status !== "active") {
        throw new Error("Choose a member of this product.");
      }
      const now = new Date().toISOString();
      const membership: MembershipRecord = {
        kind: "membership",
        schemaVersion: 1,
        membershipId: newMembershipId(),
        subjectId: target.subjectId,
        scope,
        grants: [{ scope, actions }],
        ...(role ? { accessRole: { id: role.id, name: role.name } } : {}),
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      await persistRecord(
        membership,
        "permission.granted",
        {
          kind: "subject",
          subjectId: actorMembership.subjectId,
        },
        {
          ...(role ? { accessRoleName: role.name } : {}),
          changes: [{ field: "actions", before: [], after: [...actions] }],
        },
      );
      return membership;
    }),
  );
}

export async function updateGrantStatus(
  actorId: SubjectId,
  membershipId: string,
  status: "active" | "disabled",
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(async () => {
    const initial = await loadRecord("membership", membershipId);
    if (!initial) throw new Error("Permission grant not found.");
    if (!initial.record.scope.organizationId)
      throw new Error("Legacy grants cannot be changed here.");
    await withOrganizationMutationLock(initial.record.scope.organizationId, async () => {
      const current = await loadRecord("membership", membershipId);
      if (!current || current.record.scope.organizationId !== initial.record.scope.organizationId)
        throw new Error("Permission grant not found.");
      const actorMembership = await requireProductRoleUnlocked(
        actorId,
        current.record.scope.organizationId,
        current.record.scope.productId,
        ["owner", "admin"],
      );
      if (
        status === "active" &&
        (
          await store().readOrganizationMembership(
            current.record.scope.organizationId,
            current.record.subjectId,
            current.record.scope.productId,
          )
        )?.status !== "active"
      ) {
        throw new Error("The person must be an active product member before restoring access.");
      }
      if (current.record.status === status) return;
      await persistRecord(
        { ...current.record, status, updatedAt: new Date().toISOString() },
        status === "disabled" ? "permission.revoked" : "permission.restored",
        { kind: "subject", subjectId: actorMembership.subjectId },
        { changes: [{ field: "status", before: current.record.status, after: status }] },
      );
    });
  });
}

export async function deletePermissionGrant(
  actorId: SubjectId,
  membershipId: string,
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(async () => {
    const initial = await loadRecord("membership", membershipId);
    if (!initial) throw new Error("Permission grant not found.");
    const { organizationId, productId } = initial.record.scope;

    await withOrganizationMutationLock(organizationId, async () => {
      const current = await loadRecord("membership", membershipId);
      if (
        !current ||
        current.record.scope.organizationId !== organizationId ||
        current.record.scope.productId !== productId
      ) {
        throw new Error("Permission grant not found.");
      }
      const actorMembership = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      if (current.record.status !== "disabled") {
        throw new Error("Only disabled permissions can be deleted.");
      }

      const productMembership = await store().readOrganizationMembership(
        organizationId,
        current.record.subjectId,
        productId,
      );
      const grants = productMembership?.permissionGrants ?? [];
      if (!productMembership || !grants.some((grant) => grant.membershipId === membershipId)) {
        throw new Error("Permission grant not found.");
      }

      await store().writeRecord({
        ...productMembership,
        permissionGrants: grants.filter((grant) => grant.membershipId !== membershipId),
        updatedAt: new Date().toISOString(),
      });
      invalidateOrganizationDashboardDataCache();
      await appendRecordActivityEvent(
        current.record,
        "permission.deleted",
        { kind: "subject", subjectId: actorMembership.subjectId },
        { changes: [{ field: "status", before: "disabled", after: "deleted" }] },
      );
    });
  });
}

export async function listMembershipsForSubject(subjectId: SubjectId): Promise<MembershipRecord[]> {
  return authMutationQueue.run(() => listMembershipsForSubjectUnlocked(subjectId));
}

async function listMembershipsForSubjectUnlocked(
  subjectId: SubjectId,
): Promise<MembershipRecord[]> {
  return (await store().listMembershipsForSubject(subjectId))
    .flatMap((membership) => membership.permissionGrants ?? [])
    .filter((record) => record.subjectId === subjectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function scopeMatchesGrant(grantScope: ResourceScope, request: ResourceScope): boolean {
  if (
    grantScope.organizationId.toLowerCase() !== request.organizationId.toLowerCase() ||
    grantScope.productId.toLowerCase() !== request.productId.toLowerCase()
  )
    return false;
  if (grantScope.kind === "product") return true;
  if (grantScope.kind !== request.kind) return false;
  if (grantScope.kind === "project" && request.kind === "project")
    return grantScope.projectId.toLowerCase() === request.projectId.toLowerCase();
  if (grantScope.kind === "workspace" && request.kind === "workspace")
    return grantScope.workspaceId.toLowerCase() === request.workspaceId.toLowerCase();
  return false;
}

export function productMembershipHasPermission(
  membership: OrganizationMembershipRecord,
  scope: ResourceScope,
  action: string,
): boolean {
  if (membership.status !== "active") return false;
  return (membership.permissionGrants ?? []).some(
    (grantRecord) =>
      grantRecord.status === "active" &&
      grantRecord.grants.some(
        (grant: PermissionGrant) =>
          scopeMatchesGrant(grant.scope, scope) && grant.actions.includes(action),
      ),
  );
}
