import "server-only";

import { mapWithConcurrency } from "../concurrency";
import { consumerProductPolicy, consumerRoleActions, scopeResourceId } from "../consumer-policy";
import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  type MembershipRecord,
  newMembershipId,
  newOrganizationMembershipId,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type ResourceScope,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { createAdminProvisionedSubject } from "./core";
import { createRoleMembershipRecord } from "./membership-record";
import { createPasswordCredential } from "./passwords";
import {
  listRecordsWithRecovery,
  loadApprovedOrganizationUnlocked,
  loadSubjectByEmailUnlocked,
  loadSubjectByUsernameUnlocked,
  loadSubjectUnlocked,
  persistRecord,
  requireOrganizationProductUnlocked,
  requireOrganizationRoleUnlocked,
  store,
} from "./persistence";
import {
  canonicalEmail,
  consumerProductState,
  normalizeProductUsername,
  productMembershipHasPermission,
  requireVerifiedActiveSubject,
  scopeMatchesGrant,
  updateConsumerProductState,
  validatePassword,
  validateProductId,
  validateScope,
} from "./validators";

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

export interface ConsumerAccountView {
  subjectId: SubjectId;
  email: string | null;
  username: string;
  status: "active" | "disabled";
  platformAdmin: boolean;
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

function sameConsumerMemberScope(
  grantScope: ResourceScope,
  requestedScope: ResourceScope,
): boolean {
  if (sameResourceScope(grantScope, requestedScope)) return true;
  return (
    requestedScope.kind === "project" &&
    grantScope.kind === "workspace" &&
    grantScope.organizationId.toLowerCase() === requestedScope.organizationId.toLowerCase() &&
    grantScope.productId.toLowerCase() === requestedScope.productId.toLowerCase() &&
    grantScope.workspaceId.toLowerCase() === requestedScope.projectId.toLowerCase()
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
  return createRoleMembershipRecord(
    authenticatedProductId,
    subjectId,
    scope,
    role,
    actions,
    existing,
  );
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
  await requireOrganizationProductUnlocked(scope.organizationId, scope.productId, true);
  const membership = await store().readOrganizationMembership(
    scope.organizationId,
    actorId,
    scope.productId,
  );
  if (
    !membership ||
    membership.status !== "active" ||
    !membership.permissionGrants?.some(
      (grant) =>
        grant.status === "active" &&
        (scopeMatchesGrant(grant.scope, scope) || sameConsumerMemberScope(grant.scope, scope)) &&
        grant.grants.some(
          (permission) =>
            (scopeMatchesGrant(permission.scope, scope) ||
              sameConsumerMemberScope(permission.scope, scope)) &&
            permission.actions.includes(policy.memberManagementAction),
        ),
    )
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
  await requireOrganizationProductUnlocked(organizationId, productId, true);
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
  const grants = membership.permissionGrants ?? [];
  return (
    grants.find((grant) => sameResourceScope(grant.scope, scope)) ??
    grants.find((grant) => sameConsumerMemberScope(grant.scope, scope)) ??
    null
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
        membership.permissionGrants?.some((grant) => sameConsumerMemberScope(grant.scope, scope)),
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

type ManagedResourceKind = "workspace" | "project";
type ResourceManagementContext = {
  organizationId: string;
  resourceId: string;
  productId: string;
  scope: Extract<ResourceScope, { kind: ManagedResourceKind }>;
};

async function withConsumerResourceManagement<T>(
  actorId: SubjectId,
  productIdInput: string,
  organizationIdInput: string,
  resourceIdInput: string,
  resourceKind: ManagedResourceKind,
  operation: (context: ResourceManagementContext) => Promise<T>,
): Promise<T> {
  const productId = validateProductId(productIdInput);
  const organizationId = organizationIdInput.trim().toLowerCase();
  const resourceId = resourceIdInput.trim().toLowerCase();
  assertOpaqueId(organizationId);
  const scope = validateScope(
    resourceKind === "workspace"
      ? {
          kind: "workspace",
          organizationId: organizationId as OrganizationId,
          productId,
          workspaceId: resourceId,
        }
      : {
          kind: "project",
          organizationId: organizationId as OrganizationId,
          productId,
          projectId: resourceId,
        },
  ) as Extract<ResourceScope, { kind: ManagedResourceKind }>;
  if (resourceKind === "workspace") assertOpaqueId(resourceId);

  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
      await requireOrganizationProductUnlocked(organizationId, productId);
      return operation({ organizationId, resourceId, productId, scope });
    }),
  );
}

type ConsumerResourceAction = "bootstrap" | "revoke";
type ConsumerResourceAdminOperation = (
  actorId: SubjectId,
  productId: string,
  organizationId: string,
  resourceId: string,
) => Promise<void>;

async function manageConsumerResourceAdmin(
  action: ConsumerResourceAction,
  actorId: SubjectId,
  productId: string,
  organizationId: string,
  resourceId: string,
  resourceKind: ManagedResourceKind,
): Promise<void> {
  await withConsumerResourceManagement(
    actorId,
    productId,
    organizationId,
    resourceId,
    resourceKind,
    async ({ organizationId: normalizedOrganizationId, productId: normalizedProductId, scope }) => {
      if (action === "bootstrap") {
        const actor = await loadSubjectUnlocked(actorId);
        requireVerifiedActiveSubject(actor);
        if (consumerProductState(actor, normalizedProductId).status !== "active") {
          throw new Error("This account is disabled for the application.");
        }

        const existingMembership = await store().readOrganizationMembership(
          normalizedOrganizationId,
          actorId,
          normalizedProductId,
        );
        if (existingMembership?.status === "disabled") {
          throw new Error("This account is disabled for the application.");
        }
        const membership =
          existingMembership ??
          (await ensureConsumerProductMembershipUnlocked(
            actor,
            normalizedOrganizationId,
            normalizedProductId,
          ));
        const actions = consumerRoleActions(normalizedProductId, "admin", resourceKind);
        if (!actions) throw new Error(`${resourceKind} administration is unavailable.`);
        const currentGrant = consumerMemberGrant(membership, scope);
        const grant = roleGrant(
          normalizedProductId,
          actorId,
          scope,
          "admin",
          actions,
          currentGrant ?? undefined,
        );
        const event =
          resourceKind === "workspace"
            ? "consumer.workspace-admin-bootstrapped"
            : "consumer.project-admin-bootstrapped";
        await persistRecord(grant, event, { kind: "subject", subjectId: actorId });
        return;
      }

      const memberships = await store().listOrganizationMemberships(
        normalizedOrganizationId,
        normalizedProductId,
      );
      for (const membership of memberships) {
        if (membership.productId !== normalizedProductId) continue;
        for (const grant of membership.permissionGrants ?? []) {
          if (!sameResourceScope(grant.scope, scope) || grant.status !== "active") continue;
          const event =
            resourceKind === "workspace"
              ? "consumer.workspace-access-revoked"
              : "consumer.project-access-revoked";
          await persistRecord(
            { ...grant, status: "disabled", updatedAt: new Date().toISOString() },
            event,
            { kind: "subject", subjectId: actorId },
          );
        }
      }
    },
  );
}

function consumerResourceAdminOperation(
  action: ConsumerResourceAction,
  resourceKind: ManagedResourceKind,
): ConsumerResourceAdminOperation {
  return (actorId, productId, organizationId, resourceId) =>
    manageConsumerResourceAdmin(
      action,
      actorId,
      productId,
      organizationId,
      resourceId,
      resourceKind,
    );
}

export const bootstrapWorkspaceAdmin = consumerResourceAdminOperation("bootstrap", "workspace");
export const revokeWorkspaceGrants = consumerResourceAdminOperation("revoke", "workspace");
export const bootstrapProjectAdmin = consumerResourceAdminOperation("bootstrap", "project");
export const revokeProjectGrants = consumerResourceAdminOperation("revoke", "project");

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

async function protectLastResourceAdminUnlocked(
  targetId: SubjectId,
  scope: ResourceScope,
  currentGrant: MembershipRecord,
  nextRole: string | null,
  nextStatus: "active" | "disabled",
): Promise<void> {
  if (
    (scope.kind !== "workspace" && scope.kind !== "project") ||
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
          sameConsumerMemberScope(grant.scope, scope) &&
          grant.status === "active" &&
          grant.accessRole?.name === "admin" &&
          grant.subjectId !== targetId,
      );
    if (hasActiveAdminGrant) {
      const subject = await loadSubjectUnlocked(membership.subjectId);
      if (subject?.status === "active") return;
    }
  }
  throw new Error("This project or workspace must keep an active administrator.");
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
      await protectLastResourceAdminUnlocked(subjectId, scope, currentGrant, nextRole, nextStatus);
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
