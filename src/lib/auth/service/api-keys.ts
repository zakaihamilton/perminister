import "server-only";

import { randomBytes } from "node:crypto";
import { cache } from "react";
import { withOrganizationMutationLock } from "../coordination";
import {
  type ApiKeyOwner,
  type ApiKeyRecord,
  assertOpaqueId,
  newApiKeyId,
  newServicePrincipalId,
  type OrganizationId,
  type ResourceScope,
  type ServicePrincipalId,
  type ServicePrincipalRecord,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { hashHex } from "./passwords";
import {
  listRecordsWithRecovery,
  loadApprovedOrganizationUnlocked,
  loadRecord,
  loadSubjectUnlocked,
  persistRecord,
  requireOrganizationProductUnlocked,
  requireOrganizationRoleUnlocked,
  store,
} from "./persistence";
import {
  isAdministrator,
  isEmailVerifiedOrExempt,
  productMembershipHasPermission,
  validateActions,
  validateProductId,
  validateScope,
} from "./validators";

export interface CreateApiKeyOptions {
  scope: ResourceScope;
  actions: readonly string[];
  expiresAt: string | null;
  rotateFromApiKeyId?: string;
}

export interface CreatedApiKey {
  record: ApiKeyRecord;
  token: string;
  rotationWarning: string | null;
}

function validateApiKeyOptions(options: CreateApiKeyOptions) {
  const scope = validateScope(options.scope);
  const actions = validateActions(options.actions);
  if (
    options.expiresAt &&
    (!Number.isFinite(Date.parse(options.expiresAt)) || Date.parse(options.expiresAt) <= Date.now())
  ) {
    throw new Error("Choose a future expiration time.");
  }
  const rotateId = options.rotateFromApiKeyId;
  if (rotateId) assertOpaqueId(rotateId);
  return { scope, actions, rotateId };
}

function createApiKeyDraft(
  owner: ApiKeyOwner,
  scope: ResourceScope,
  actions: readonly string[],
  expiresAt: string | null,
  previous: ApiKeyRecord | null,
): { record: ApiKeyRecord; token: string } {
  const apiKeyId = newApiKeyId();
  const token = `pmk_${apiKeyId}_${randomBytes(32).toString("base64url")}`;
  const record: ApiKeyRecord = {
    kind: "api-key",
    schemaVersion: 1,
    apiKeyId,
    keyClass: "integration",
    owner,
    scope,
    actions,
    verifier: { algorithm: "sha256", digestHex: hashHex(token) },
    status: "active",
    createdAt: new Date().toISOString(),
    expiresAt,
    revokedAt: null,
    rotatedFromApiKeyId: previous?.apiKeyId ?? null,
  };
  return { record, token };
}

async function findApiKeyToRotate(
  apiKeyId: string | undefined,
  owner: ApiKeyOwner,
  organizationId: string,
  ownerError: string,
): Promise<ApiKeyRecord | null> {
  if (!apiKeyId) return null;
  const existing = await loadRecord("api-key", apiKeyId);
  const matchesOwner =
    existing &&
    (owner.kind === "subject"
      ? existing.record.owner.kind === "subject" &&
        existing.record.owner.subjectId === owner.subjectId
      : existing.record.owner.kind === "service" &&
        existing.record.owner.servicePrincipalId === owner.servicePrincipalId);
  if (!existing || !matchesOwner) throw new Error(ownerError);
  if (
    existing.record.status !== "active" ||
    (existing.record.expiresAt && Date.parse(existing.record.expiresAt) <= Date.now())
  ) {
    throw new Error("Only an active, unexpired API key can be rotated.");
  }
  if (existing.record.scope.organizationId !== organizationId) {
    throw new Error("A key can only be rotated within its organization.");
  }
  return existing.record;
}

async function createApiKeyWithRotationUnlocked(
  owner: ApiKeyOwner,
  scope: ResourceScope,
  actions: readonly string[],
  expiresAt: string | null,
  previous: ApiKeyRecord | null,
  actorSubjectId: SubjectId,
  events: {
    created: string;
    rotatedCreated: string;
    revokedPrevious: string;
    rotationWarning: string;
  },
): Promise<CreatedApiKey> {
  const { record, token } = createApiKeyDraft(owner, scope, actions, expiresAt, previous);
  const actor = { kind: "subject" as const, subjectId: actorSubjectId };
  await persistRecord(record, previous ? events.rotatedCreated : events.created, actor, {
    keyClass: record.keyClass,
    expiresAt: record.expiresAt,
    changes: [{ field: "actions", before: [], after: [...record.actions] }],
  });
  let rotationWarning: string | null = null;
  if (previous) {
    try {
      await persistRecord(
        { ...previous, status: "revoked", revokedAt: new Date().toISOString() },
        events.revokedPrevious,
        actor,
      );
    } catch {
      rotationWarning = events.rotationWarning;
    }
  }
  return { record, token, rotationWarning };
}

export async function createServicePrincipal(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  nameInput: string,
): Promise<ServicePrincipalRecord> {
  const scope = validateScope({
    kind: "product",
    organizationId: organizationId as OrganizationId,
    productId,
  });
  const name = nameInput.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new Error("Integration names must be 2 to 80 characters.");
  }
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actor = await requireOrganizationRoleUnlocked(actorId, scope.organizationId, [
        "owner",
        "admin",
      ]);
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      const now = new Date().toISOString();
      const principal: ServicePrincipalRecord = {
        kind: "service-principal",
        schemaVersion: 1,
        servicePrincipalId: newServicePrincipalId(),
        organizationId: scope.organizationId,
        productId: scope.productId,
        name,
        status: "active",
        createdBySubjectId: actor.subjectId,
        createdAt: now,
        updatedAt: now,
      };
      await persistRecord(principal, "service-principal.created", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return principal;
    }),
  );
}

export async function listServicePrincipalsForOrganization(
  actorId: SubjectId,
  organizationId: string,
  productId?: string,
): Promise<ServicePrincipalRecord[]> {
  const normalizedProductId = productId === undefined ? undefined : validateProductId(productId);
  const normalizedOrganizationId = organizationId.toLowerCase();
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(actorId, normalizedOrganizationId, ["owner", "admin"]);
    return (await listRecordsWithRecovery("service-principal"))
      .map((item) => item.record)
      .filter(
        (principal) =>
          principal.organizationId === normalizedOrganizationId &&
          (normalizedProductId === undefined || principal.productId === normalizedProductId),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  });
}

export async function updateServicePrincipalStatus(
  actorId: SubjectId,
  servicePrincipalId: string,
  status: "active" | "disabled",
  expectedProductId?: string,
): Promise<void> {
  assertOpaqueId(servicePrincipalId);
  const normalizedProductId =
    expectedProductId === undefined ? undefined : validateProductId(expectedProductId);
  const initial = await loadRecord("service-principal", servicePrincipalId);
  if (
    !initial ||
    (normalizedProductId !== undefined && initial.record.productId !== normalizedProductId)
  ) {
    throw new Error("Integration not found.");
  }
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(initial.record.organizationId, async () => {
      const actor = await requireOrganizationRoleUnlocked(actorId, initial.record.organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("service-principal", servicePrincipalId);
      if (
        !current ||
        current.record.organizationId !== initial.record.organizationId ||
        (normalizedProductId !== undefined && current.record.productId !== normalizedProductId)
      ) {
        throw new Error("Integration not found.");
      }
      if (current.record.status === status) return;
      if (status === "active") {
        await requireOrganizationProductUnlocked(
          current.record.organizationId,
          current.record.productId,
        );
      }
      const updated: ServicePrincipalRecord = {
        ...current.record,
        status,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(
        updated,
        status === "disabled" ? "service-principal.disabled" : "service-principal.enabled",
        { kind: "subject", subjectId: actor.subjectId },
      );
      if (status === "disabled") {
        const keys = (await listRecordsWithRecovery("api-key")).map((item) => item.record);
        for (const key of keys) {
          if (key.owner.kind !== "service" || key.owner.servicePrincipalId !== servicePrincipalId)
            continue;
          if (key.status === "revoked") continue;
          await persistRecord(
            { ...key, status: "revoked", revokedAt: new Date().toISOString() },
            "api-key.service-principal-disabled",
            { kind: "subject", subjectId: actor.subjectId },
          );
        }
      }
    }),
  );
}

export async function createApiKeyForServicePrincipal(
  actorId: SubjectId,
  servicePrincipalId: string,
  options: CreateApiKeyOptions,
): Promise<CreatedApiKey> {
  assertOpaqueId(servicePrincipalId);
  const { scope, actions, rotateId } = validateApiKeyOptions(options);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actor = await requireOrganizationRoleUnlocked(actorId, scope.organizationId, [
        "owner",
        "admin",
      ]);
      const principal = await loadRecord("service-principal", servicePrincipalId);
      if (
        !principal ||
        principal.record.status !== "active" ||
        principal.record.organizationId !== scope.organizationId ||
        principal.record.productId !== scope.productId
      ) {
        throw new Error("Choose an active integration for this organization and product.");
      }
      const previous = await findApiKeyToRotate(
        rotateId,
        { kind: "service", servicePrincipalId: servicePrincipalId as ServicePrincipalId },
        scope.organizationId,
        "Choose one of this integration's API keys to rotate.",
      );
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      return createApiKeyWithRotationUnlocked(
        { kind: "service", servicePrincipalId: servicePrincipalId as ServicePrincipalId },
        scope,
        actions,
        options.expiresAt,
        previous,
        actor.subjectId,
        {
          created: "api-key.service-created",
          rotatedCreated: "api-key.service-rotated.created",
          revokedPrevious: "api-key.service-rotated.revoked-previous",
          rotationWarning:
            "The new key was created, but the previous key could not be revoked. Revoke it from the integration key list.",
        },
      );
    }),
  );
}

export async function listApiKeysForServicePrincipal(
  actorId: SubjectId,
  servicePrincipalId: string,
  expectedProductId?: string,
): Promise<ApiKeyRecord[]> {
  assertOpaqueId(servicePrincipalId);
  const normalizedProductId =
    expectedProductId === undefined ? undefined : validateProductId(expectedProductId);
  return authMutationQueue.run(async () => {
    const principal = await loadRecord("service-principal", servicePrincipalId);
    if (
      !principal ||
      (normalizedProductId !== undefined && principal.record.productId !== normalizedProductId)
    ) {
      throw new Error("Integration not found.");
    }
    await requireOrganizationRoleUnlocked(actorId, principal.record.organizationId, [
      "owner",
      "admin",
    ]);
    return (await listRecordsWithRecovery("api-key"))
      .map((item) => item.record)
      .filter(
        (key) =>
          key.owner.kind === "service" && key.owner.servicePrincipalId === servicePrincipalId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export async function revokeServicePrincipalApiKey(
  actorId: SubjectId,
  servicePrincipalId: string,
  apiKeyId: string,
  expectedProductId?: string,
): Promise<void> {
  assertOpaqueId(servicePrincipalId);
  assertOpaqueId(apiKeyId);
  const normalizedProductId =
    expectedProductId === undefined ? undefined : validateProductId(expectedProductId);
  await authMutationQueue.run(async () => {
    const principal = await loadRecord("service-principal", servicePrincipalId);
    const key = await loadRecord("api-key", apiKeyId);
    if (
      !principal ||
      !key ||
      (normalizedProductId !== undefined && principal.record.productId !== normalizedProductId) ||
      key.record.owner.kind !== "service" ||
      key.record.owner.servicePrincipalId !== servicePrincipalId
    ) {
      throw new Error("Integration key not found.");
    }
    const actor = await requireOrganizationRoleUnlocked(actorId, principal.record.organizationId, [
      "owner",
      "admin",
    ]);
    if (key.record.status === "revoked") return;
    await persistRecord(
      { ...key.record, status: "revoked", revokedAt: new Date().toISOString() },
      "api-key.service-revoked",
      { kind: "subject", subjectId: actor.subjectId },
    );
  });
}

export async function createApiKeyForSubject(
  subjectId: SubjectId,
  options: CreateApiKeyOptions,
): Promise<CreatedApiKey> {
  const { scope, actions, rotateId } = validateApiKeyOptions(options);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const subject = await loadSubjectUnlocked(subjectId);
      if (!subject || subject.status !== "active" || !isEmailVerifiedOrExempt(subject)) {
        throw new Error("An active, email-verified account is required to create an API key.");
      }
      if (!(await loadApprovedOrganizationUnlocked(scope.organizationId))) {
        throw new Error("Organization not found.");
      }
      const productMembership = await store().readOrganizationMembership(
        scope.organizationId,
        subjectId,
        scope.productId,
      );
      if (!productMembership || productMembership.status !== "active") {
        throw new Error("Join this product before creating an API key.");
      }
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      for (const action of actions) {
        if (!productMembershipHasPermission(productMembership, scope, action)) {
          throw new Error("API keys can only include actions granted to your account.");
        }
      }
      const previous = await findApiKeyToRotate(
        rotateId,
        { kind: "subject", subjectId },
        scope.organizationId,
        "Choose one of your own API keys to rotate.",
      );
      return createApiKeyWithRotationUnlocked(
        { kind: "subject", subjectId },
        scope,
        actions,
        options.expiresAt,
        previous,
        subjectId,
        {
          created: "api-key.created",
          rotatedCreated: "api-key.rotated.created",
          revokedPrevious: "api-key.rotated.revoked-previous",
          rotationWarning:
            "The new key was created, but the previous key could not be revoked. Revoke it from the key list.",
        },
      );
    }),
  );
}

export const listApiKeysForSubject = cache(async function listApiKeysForSubject(
  subjectId: SubjectId,
): Promise<ApiKeyRecord[]> {
  return authMutationQueue.read(async () => {
    const keys = await store().listApiKeysForSubject(subjectId);
    return keys.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
});

export async function revokeApiKeyForSubject(actorId: SubjectId, apiKeyId: string): Promise<void> {
  assertOpaqueId(apiKeyId);
  await authMutationQueue.run(async () => {
    const actor = await loadSubjectUnlocked(actorId);
    if (!actor || actor.status !== "active") throw new Error("An active account is required.");
    const initial = await loadRecord("api-key", apiKeyId);
    if (!initial) throw new Error("API key not found.");
    const revoke = async () => {
      const current = await loadRecord("api-key", apiKeyId);
      if (!current) throw new Error("API key not found.");
      const ownsKey =
        current.record.owner.kind === "subject" && current.record.owner.subjectId === actorId;
      if (!ownsKey && !isAdministrator(actor)) throw new Error("You cannot revoke this API key.");
      if (current.record.status === "revoked") return;
      await persistRecord(
        { ...current.record, status: "revoked", revokedAt: new Date().toISOString() },
        "api-key.revoked",
        { kind: "subject", subjectId: actorId },
      );
    };
    if (initial.record.scope.organizationId) {
      await withOrganizationMutationLock(initial.record.scope.organizationId, revoke);
    } else {
      await revoke();
    }
  });
}
