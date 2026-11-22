import "server-only";

import { cache } from "react";
import { mapWithConcurrency } from "../concurrency";
import { withOrganizationMutationLock } from "../coordination";
import {
  type ApiKeyId,
  type AuthActor,
  type AuthAggregate,
  type AuthEvent,
  type AuthRecord,
  type AuthRecordFor,
  type AuthRecordKind,
  assertOpaqueId,
  authRecordId,
  type ConsumerAuthorizationCodeId,
  type ConsumerClientId,
  type EmailActionId,
  type InvitationId,
  type MembershipId,
  newEventId,
  type OrganizationId,
  type OrganizationMembershipId,
  type OrganizationMembershipRecord,
  type OrganizationRecord,
  type OrganizationRole,
  type ProductRecordId,
  type ServicePrincipalId,
  type SessionId,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { withRequestPerformanceSpan } from "../performance";
import { createSpacesAuthStoreFromEnv, type VersionedRecord } from "../storage/spaces";
import { invalidateOrganizationDashboardDataCache } from "./dashboard-cache";
import {
  isAdministrator,
  organizationApprovalStatus,
  requireVerifiedActiveSubject,
  validateProductId,
} from "./validators";

let storeSingleton: ReturnType<typeof createSpacesAuthStoreFromEnv> | undefined;

export function store() {
  storeSingleton ??= createSpacesAuthStoreFromEnv();
  return storeSingleton;
}

export const listProductsByProductIdDuringRender = cache((productId: string) =>
  store().listProductsByProductId(validateProductId(productId)),
);

export const listMembershipsForSubjectDuringRender = cache((subjectId: SubjectId) =>
  withRequestPerformanceSpan("dashboard.memberships", () =>
    store().listMembershipsForSubject(subjectId),
  ),
);

export const listProductsForOrganizationDuringRender = cache((organizationId: string) =>
  withRequestPerformanceSpan("dashboard.products", () => store().listProducts(organizationId)),
);

function aggregateFor(kind: AuthRecordKind, id: string): AuthAggregate {
  assertOpaqueId(id);
  switch (kind) {
    case "organization":
      return { kind, id: id as OrganizationId };
    case "organization-membership":
      return { kind, id: id as OrganizationMembershipId };
    case "product":
      return { kind, id: id as ProductRecordId };
    case "organization-invitation":
      return { kind, id: id as InvitationId };
    case "subject":
      return { kind, id: id as SubjectId };
    case "membership":
      return { kind, id: id as MembershipId };
    case "service-principal":
      return { kind, id: id as ServicePrincipalId };
    case "api-key":
      return { kind, id: id as ApiKeyId };
    case "consumer-client":
      return { kind, id: id as ConsumerClientId };
    case "oauth-client-registration":
      return { kind, id: id as ConsumerClientId };
    case "consumer-authorization-code":
      return { kind, id: id as ConsumerAuthorizationCodeId };
    case "session":
      return { kind, id: id as SessionId };
    case "email-action":
      return { kind, id: id as EmailActionId };
  }
}

export async function loadRecord<Kind extends AuthRecordKind>(
  kind: Kind,
  id: string,
): Promise<VersionedRecord<AuthRecordFor<Kind>> | null> {
  return store().readRecord(kind, id);
}

export async function listRecordsWithRecovery<Kind extends AuthRecordKind>(
  kind: Kind,
): Promise<VersionedRecord<AuthRecordFor<Kind>>[]> {
  return store().listRecords(kind);
}

function activityPayload(record: AuthRecord): AuthEvent["payload"] {
  const payload: AuthEvent["payload"] = {};
  if (record.kind === "organization") {
    payload.organizationId = record.organizationId;
  } else if (record.kind === "organization-membership") {
    payload.organizationId = record.organizationId;
    payload.subjectId = record.subjectId;
    if (record.productId) payload.productId = record.productId;
  } else if (record.kind === "product") {
    payload.organizationId = record.organizationId;
    payload.productId = record.productId;
  } else if (record.kind === "organization-invitation") {
    payload.organizationId = record.organizationId;
    if (record.productId) payload.productId = record.productId;
  } else if (record.kind === "membership") {
    payload.organizationId = record.scope.organizationId;
    payload.productId = record.scope.productId;
    payload.subjectId = record.subjectId;
    if (record.accessRole?.name) payload.accessRoleName = record.accessRole.name;
  } else if (record.kind === "service-principal") {
    payload.organizationId = record.organizationId;
    payload.productId = record.productId;
    payload.subjectId = record.createdBySubjectId;
  } else if (record.kind === "api-key") {
    payload.organizationId = record.scope.organizationId;
    payload.productId = record.scope.productId;
    if (record.owner.kind === "subject") payload.subjectId = record.owner.subjectId;
  } else if (record.kind === "consumer-client") {
    if (record.organizationId) payload.organizationId = record.organizationId;
    payload.productId = record.productId;
    payload.subjectId = record.createdBySubjectId;
  } else if (record.kind === "oauth-client-registration") {
    payload.clientId = record.oauthClientId;
  } else {
    payload.subjectId = record.subjectId;
  }
  return payload;
}

export async function persistRecord(
  record: AuthRecord,
  type: string,
  actor: AuthActor,
  additionalPayload: AuthEvent["payload"] = {},
): Promise<void> {
  const objectStore = store();
  const now = new Date().toISOString();
  if (record.kind === "membership") {
    const productMembership = await objectStore.readOrganizationMembership(
      record.scope.organizationId,
      record.subjectId,
      record.scope.productId,
    );
    if (!productMembership) throw new Error("Product membership not found.");
    const grants = productMembership.permissionGrants ?? [];
    const nextGrants = grants.some((grant) => grant.membershipId === record.membershipId)
      ? grants.map((grant) => (grant.membershipId === record.membershipId ? record : grant))
      : [...grants, record];
    await objectStore.writeRecord({
      ...productMembership,
      permissionGrants: nextGrants,
      updatedAt: now,
    });
  } else {
    await objectStore.writeRecord(record);
  }
  invalidateOrganizationDashboardDataCache();
  await appendRecordActivityEvent(record, type, actor, additionalPayload);
}

export async function appendRecordActivityEvent(
  record: AuthRecord,
  type: string,
  actor: AuthActor,
  additionalPayload: AuthEvent["payload"] = {},
): Promise<void> {
  const objectStore = store();
  const id = authRecordId(record);
  const event: AuthEvent = {
    schemaVersion: 1,
    eventId: newEventId(),
    aggregate: aggregateFor(record.kind, id),
    aggregateVersion: 1,
    occurredAt: new Date().toISOString(),
    actor,
    type,
    payload: { ...activityPayload(record), ...additionalPayload },
  };
  try {
    await objectStore.appendEvent(event);
  } catch (error) {
    console.error("Canonical auth record committed but activity append failed", {
      kind: record.kind,
      id,
      eventId: event.eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function loadSubjectUnlocked(subjectId: string): Promise<SubjectRecord | null> {
  const value = await loadRecord("subject", subjectId);
  return value && !value.record.deletedAt ? value.record : null;
}

export async function loadSubjectByEmailUnlocked(email: string): Promise<SubjectRecord | null> {
  const subjectId = await store().findSubjectIdByEmail(email);
  return subjectId ? loadSubjectUnlocked(subjectId) : null;
}

export async function loadSubjectByExternalIdentityUnlocked(
  provider: "google",
  providerSubject: string,
): Promise<SubjectRecord | null> {
  const subjectId = await store().findSubjectIdByExternalIdentity(provider, providerSubject);
  return subjectId ? loadSubjectUnlocked(subjectId) : null;
}

export async function loadSubjectByUsernameUnlocked(
  productId: string,
  username: string,
): Promise<SubjectRecord | null> {
  const subjectId = await store().findSubjectIdByUsername(productId, username);
  return subjectId ? loadSubjectUnlocked(subjectId) : null;
}

export function mapMembershipsToSubjectContact<T extends { subjectId: string }>(memberships: T[]) {
  return mapWithConcurrency(memberships, async (membership) => {
    const subject = await loadSubjectUnlocked(membership.subjectId);
    return {
      membership,
      email: subject?.primaryEmail ?? null,
      emailVerified: !!subject?.emailVerifiedAt,
    };
  });
}

export async function requireAdministrator(subjectId: SubjectId): Promise<SubjectRecord> {
  const actor = await loadSubjectUnlocked(subjectId);
  if (!actor || actor.status !== "active" || !isAdministrator(actor)) {
    throw new Error("Administrator access is required.");
  }
  return actor;
}

export async function loadApprovedOrganizationUnlocked(
  organizationId: string,
): Promise<OrganizationRecord | null> {
  const organization = await loadRecord("organization", organizationId);
  if (!organization || organizationApprovalStatus(organization.record) !== "approved") return null;
  return organization.record;
}

export async function organizationMembershipUnlocked(
  organizationId: string,
  subjectId: SubjectId,
): Promise<OrganizationMembershipRecord | null> {
  const membership = await store().readOrganizationMembership(organizationId, subjectId);
  return membership?.status === "active" ? membership : null;
}

export async function requireOrganizationRoleUnlocked(
  actorId: SubjectId,
  organizationId: string,
  roles: readonly OrganizationRole[],
): Promise<OrganizationMembershipRecord> {
  assertOpaqueId(organizationId);
  const [actor, organization, membership] = await Promise.all([
    loadSubjectUnlocked(actorId),
    loadApprovedOrganizationUnlocked(organizationId),
    organizationMembershipUnlocked(organizationId, actorId),
  ]);
  requireVerifiedActiveSubject(actor);
  if (!organization) throw new Error("Organization not found.");
  if (!membership || !roles.includes(membership.role)) {
    throw new Error("You do not have permission to manage this organization.");
  }
  return membership;
}

export async function requireOrganizationProductUnlocked(
  organizationId: string,
  productId: string,
  allowArchived = false,
): Promise<void> {
  const product = await store().readProduct(organizationId, productId);
  if (!product) {
    throw new Error("Choose a product in this organization.");
  }
  if (product.pendingMove) {
    throw new Error("A product move is in progress. Resume it before making changes.");
  }
  if (!allowArchived && product.archivedAt) {
    throw new Error("This product is archived. Restore it before making changes.");
  }
}

export async function withOrganizationMutationLocks<Result>(
  organizationIds: readonly string[],
  operation: () => Promise<Result>,
): Promise<Result> {
  const ordered = [...new Set(organizationIds)].sort();
  const lockAt = (index: number): Promise<Result> =>
    index >= ordered.length
      ? operation()
      : withOrganizationMutationLock(ordered[index], () => lockAt(index + 1));
  return lockAt(0);
}
