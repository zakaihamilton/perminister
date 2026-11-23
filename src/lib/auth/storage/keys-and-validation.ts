import "server-only";

import {
  type AuthEvent,
  type AuthRecord,
  type AuthRecordKind,
  assertOpaqueId,
  authRecordId,
} from "../domain";

export const OBJECT_ROOT = "";
export const OBJECT_PREFIX = OBJECT_ROOT ? `${OBJECT_ROOT}/` : "";
export const INDEX_ROOT = `${OBJECT_PREFIX}indexes`;
export const ID_INDEX_ROOT = `${INDEX_ROOT}/by-id`;
export const ORGANIZATION_MEMBERSHIP_INDEX_ROOT = `${INDEX_ROOT}/by-organization-membership`;
export const ORGANIZATION_MEMBERSHIP_INDEX_MANIFEST = `${ORGANIZATION_MEMBERSHIP_INDEX_ROOT}/manifest.json`;

export interface VersionedRecord<RecordType extends AuthRecord = AuthRecord> {
  /** Compatibility shape for service callers; Spaces stores the record itself, not this envelope. */
  formatVersion: 1;
  revision: number;
  writtenAt: string;
  record: RecordType;
}

export function activityOrganizationId(event: AuthEvent): string | null {
  if (typeof event.payload.organizationId === "string") return event.payload.organizationId;
  return event.aggregate.kind === "organization" ? event.aggregate.id : null;
}

export function assertNoPlaintextSecrets(value: unknown, path = "record"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaintextSecrets(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const isPlaintextCredentialField =
      normalizedKey.includes("secret") ||
      normalizedKey.includes("token") ||
      normalizedKey === "key" ||
      normalizedKey === "apikey" ||
      normalizedKey === "rawapikey" ||
      normalizedKey === "authorization" ||
      (normalizedKey.startsWith("password") && normalizedKey !== "passwordcredential");
    if (isPlaintextCredentialField) {
      throw new Error(`Refusing to persist plaintext credential field at ${path}.${key}`);
    }
    assertNoPlaintextSecrets(nested, `${path}.${key}`);
  }
}

export function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error("Invalid S3 key segment");
  }
  return value;
}

export function recordKey(record: AuthRecord): string {
  switch (record.kind) {
    case "subject":
      return `${OBJECT_PREFIX}subjects/${record.subjectId}.json`;
    case "organization":
      return `${OBJECT_PREFIX}orgs/${record.organizationId}/organization.json`;
    case "organization-membership":
      return record.productId
        ? `${OBJECT_PREFIX}orgs/${record.organizationId}/products/${safeSegment(record.productId)}/members/${record.subjectId}.json`
        : `${OBJECT_PREFIX}orgs/${record.organizationId}/catalog-managers/${record.subjectId}.json`;
    case "product":
      return `${OBJECT_PREFIX}orgs/${record.organizationId}/products/${safeSegment(record.productId)}/product.json`;
    case "service-principal":
      return `${OBJECT_PREFIX}service-principals/${record.servicePrincipalId}.json`;
    case "organization-invitation":
      return record.productId
        ? `${OBJECT_PREFIX}orgs/${record.organizationId}/products/${safeSegment(record.productId)}/invitations/${record.invitationId}.json`
        : `${OBJECT_PREFIX}invitations/${record.invitationId}.json`;
    case "membership":
      return `${OBJECT_PREFIX}orgs/${record.scope.organizationId}/products/${safeSegment(record.scope.productId)}/members/${record.subjectId}/grants/${record.membershipId}.json`;
    case "api-key":
      return `${OBJECT_PREFIX}api-keys/${record.apiKeyId}.json`;
    case "consumer-client":
      return `${OBJECT_PREFIX}consumer-clients/${record.consumerClientId}.json`;
    case "oauth-client-registration":
      return `${OBJECT_PREFIX}oauth-client-registrations/${record.oauthClientId}.json`;
    case "consumer-authorization-code":
      return `${OBJECT_PREFIX}consumer-authorization-codes/${record.consumerAuthorizationCodeId}.json`;
    case "session":
      return `${OBJECT_PREFIX}sessions/${record.sessionId}.json`;
    case "email-action":
      return `${OBJECT_PREFIX}email-actions/${record.actionId}.json`;
  }
}

export function identityIndexKey(kind: AuthRecordKind, id: string): string {
  assertOpaqueId(id);
  return `${ID_INDEX_ROOT}/${kind}/${id}.json`;
}

export function directRecordKey(kind: AuthRecordKind, id: string): string | null {
  switch (kind) {
    case "subject":
      return `${OBJECT_PREFIX}subjects/${id}.json`;
    case "organization":
      return `${OBJECT_PREFIX}orgs/${id}/organization.json`;
    case "api-key":
      return `${OBJECT_PREFIX}api-keys/${id}.json`;
    case "consumer-client":
      return `${OBJECT_PREFIX}consumer-clients/${id}.json`;
    case "oauth-client-registration":
      return `${OBJECT_PREFIX}oauth-client-registrations/${id}.json`;
    case "consumer-authorization-code":
      return `${OBJECT_PREFIX}consumer-authorization-codes/${id}.json`;
    case "session":
      return `${OBJECT_PREFIX}sessions/${id}.json`;
    case "email-action":
      return `${OBJECT_PREFIX}email-actions/${id}.json`;
    case "service-principal":
      return `${OBJECT_PREFIX}service-principals/${id}.json`;
    default:
      return null;
  }
}

export function fallbackRecordKey(kind: AuthRecordKind, id: string): string {
  assertOpaqueId(id);
  const direct: Partial<Record<AuthRecordKind, string>> = {
    subject: `${OBJECT_PREFIX}subjects/${id}.json`,
    organization: `${OBJECT_PREFIX}orgs/${id}/organization.json`,
    "api-key": `${OBJECT_PREFIX}api-keys/${id}.json`,
    "consumer-client": `${OBJECT_PREFIX}consumer-clients/${id}.json`,
    "oauth-client-registration": `${OBJECT_PREFIX}oauth-client-registrations/${id}.json`,
    "consumer-authorization-code": `${OBJECT_PREFIX}consumer-authorization-codes/${id}.json`,
    session: `${OBJECT_PREFIX}sessions/${id}.json`,
    "email-action": `${OBJECT_PREFIX}email-actions/${id}.json`,
    "service-principal": `${OBJECT_PREFIX}service-principals/${id}.json`,
    "organization-invitation": `${OBJECT_PREFIX}invitations/${id}.json`,
  };
  if (direct[kind]) return direct[kind]!;
  throw new Error(`An identity index is required to load ${kind} ${id}`);
}

function eventIdentity(event: AuthEvent): string {
  return `${event.eventId}`;
}

export function datePart(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Activity event has an invalid timestamp");
  return date.toISOString().slice(0, 10);
}

export function eventKey(event: AuthEvent): string {
  return `${OBJECT_PREFIX}activity/events/${datePart(event.occurredAt)}/${event.occurredAt.replaceAll(":", "-")}-${eventIdentity(event)}.json`;
}

export function validateEvent(event: AuthEvent): void {
  if (event.schemaVersion !== 1) throw new Error("Unsupported auth activity schema version");
  assertOpaqueId(event.eventId);
  assertOpaqueId(event.aggregate.id);
  if (!Number.isSafeInteger(event.aggregateVersion) || event.aggregateVersion < 1) {
    throw new Error("Activity sequence must be a positive safe integer");
  }
  if (!event.type || event.type.length > 100) throw new Error("Invalid activity event type");
}

export function sortEvents(events: AuthEvent[]): AuthEvent[] {
  return events.sort(
    (left, right) =>
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
      right.eventId.localeCompare(left.eventId),
  );
}

export function isAuthRecord(value: unknown, kind: AuthRecordKind, id?: string): value is AuthRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<AuthRecord>;
  if (record.schemaVersion !== 1 || record.kind !== kind) return false;
  if (id !== undefined) {
    try {
      return authRecordId(record as AuthRecord) === id;
    } catch {
      return false;
    }
  }
  return true;
}

export function isRecordListCandidate(kind: AuthRecordKind, key: string): boolean {
  if (!key.endsWith(".json") || key.includes("/activity/") || key.includes("/indexes/")) {
    return false;
  }

  const relativeKey =
    OBJECT_PREFIX && key.startsWith(OBJECT_PREFIX) ? key.slice(OBJECT_PREFIX.length) : key;

  switch (kind) {
    case "organization":
      return /^orgs\/[^/]+\/organization\.json$/.test(relativeKey);
    case "organization-membership":
      return /^orgs\/[^/]+\/(?:catalog-managers\/[^/]+|products\/[^/]+\/members\/[^/]+)\.json$/.test(
        relativeKey,
      );
    case "product":
      return /^orgs\/[^/]+\/products\/[^/]+\/product\.json$/.test(relativeKey);
    case "organization-invitation":
      return /^(?:invitations\/[^/]+\.json|orgs\/[^/]+\/products\/[^/]+\/invitations\/[^/]+\.json)$/.test(
        relativeKey,
      );
    case "membership":
      return /^orgs\/[^/]+\/products\/[^/]+\/members\/[^/]+(?:\/grants\/[^/]+)?\.json$/.test(
        relativeKey,
      );
    case "oauth-client-registration":
      return /^oauth-client-registrations\/[^/]+\.json$/.test(relativeKey);
    default:
      return true;
  }
}

function lowercaseScopeIdentifiers(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const scope = value as Record<string, unknown>;
  if (scope.kind !== "product" && scope.kind !== "project" && scope.kind !== "workspace") {
    return value;
  }
  const normalized: Record<string, unknown> = { ...scope };
  if (typeof scope.organizationId === "string")
    normalized.organizationId = scope.organizationId.toLowerCase();
  if (typeof scope.productId === "string") normalized.productId = scope.productId.toLowerCase();
  if (scope.kind === "project" && typeof scope.projectId === "string") {
    normalized.projectId = scope.projectId.toLowerCase();
  }
  if (scope.kind === "workspace" && typeof scope.workspaceId === "string") {
    normalized.workspaceId = scope.workspaceId.toLowerCase();
  }
  return normalized;
}

export function lowercaseScopeIdentifiersInRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (record.kind === "membership" || record.kind === "api-key") {
    return { ...record, scope: lowercaseScopeIdentifiers(record.scope) };
  }
  if (record.kind === "organization-membership" && Array.isArray(record.permissionGrants)) {
    return {
      ...record,
      permissionGrants: record.permissionGrants.map((grant) => {
        if (typeof grant !== "object" || grant === null) return grant;
        const membership = grant as Record<string, unknown>;
        return { ...membership, scope: lowercaseScopeIdentifiers(membership.scope) };
      }),
    };
  }
  return value;
}

export function unwrapRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if ("record" in value && typeof value.record === "object" && value.record !== null) {
    return lowercaseScopeIdentifiersInRecord(value.record);
  }
  return lowercaseScopeIdentifiersInRecord(value);
}

export function wrapRecord<RecordType extends AuthRecord>(
  record: RecordType,
): VersionedRecord<RecordType> {
  const writtenAt = "updatedAt" in record ? record.updatedAt : record.createdAt;
  return { formatVersion: 1, revision: 1, writtenAt, record };
}
