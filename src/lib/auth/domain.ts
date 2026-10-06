import { randomUUID } from "node:crypto";

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type SubjectId = BrandedId<"SubjectId">;
export type MembershipId = BrandedId<"MembershipId">;
export type ApiKeyId = BrandedId<"ApiKeyId">;
export type ServicePrincipalId = BrandedId<"ServicePrincipalId">;
export type EventId = BrandedId<"EventId">;
export type SessionId = BrandedId<"SessionId">;
export type EmailActionId = BrandedId<"EmailActionId">;
export type DirectoryId = BrandedId<"DirectoryId">;

export const newSubjectId = (): SubjectId => randomUUID() as SubjectId;
export const newMembershipId = (): MembershipId => randomUUID() as MembershipId;
export const newApiKeyId = (): ApiKeyId => randomUUID() as ApiKeyId;
export const newServicePrincipalId = (): ServicePrincipalId =>
  randomUUID() as ServicePrincipalId;
export const newEventId = (): EventId => randomUUID() as EventId;
export const newSessionId = (): SessionId => randomUUID() as SessionId;
export const newEmailActionId = (): EmailActionId => randomUUID() as EmailActionId;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertOpaqueId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Perminister object identifiers must be UUIDs");
  }
}

/** Open product identifier so Perminister stays independent of consumer catalogs. */
export type ProductId = string;

export type ResourceScope =
  | { kind: "product"; productId: ProductId }
  | {
      kind: "project";
      productId: ProductId;
      projectId: string;
    }
  | {
      kind: "workspace";
      productId: ProductId;
      workspaceId: string;
    };

export interface PermissionGrant {
  scope: ResourceScope;
  actions: readonly string[];
}

export type PasswordHashAlgorithm = "argon2id" | "scrypt";

export interface PasswordCredential {
  algorithm: PasswordHashAlgorithm;
  /** Encoded one-way verifier, including any salt and parameters required by the algorithm. */
  encodedVerifier: string;
  updatedAt: string;
}

export interface SubjectRecord {
  kind: "subject";
  schemaVersion: 1;
  subjectId: SubjectId;
  status: "active" | "disabled";
  primaryEmail: string | null;
  emailVerifiedAt: string | null;
  passwordCredential: PasswordCredential | null;
  /** Incremented after credential changes to invalidate every older session. */
  authVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipRecord {
  kind: "membership";
  schemaVersion: 1;
  membershipId: MembershipId;
  subjectId: SubjectId;
  scope: ResourceScope;
  grants: readonly PermissionGrant[];
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export type ApiKeyOwner =
  | { kind: "subject"; subjectId: SubjectId }
  | { kind: "service"; servicePrincipalId: ServicePrincipalId };

export interface ApiKeyRecord {
  kind: "api-key";
  schemaVersion: 1;
  apiKeyId: ApiKeyId;
  keyClass: "project" | "user" | "tool" | "gateway" | "integration";
  owner: ApiKeyOwner;
  scope: ResourceScope;
  actions: readonly string[];
  /** Hash of a high-entropy secret. The plaintext secret is never part of a record. */
  verifier: { algorithm: "sha256"; digestHex: string };
  status: "active" | "revoked";
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFromApiKeyId: ApiKeyId | null;
}

export interface SessionRecord {
  kind: "session";
  schemaVersion: 1;
  sessionId: SessionId;
  subjectId: SubjectId;
  /** Digest of the browser-held random session secret. */
  verifierDigestHex: string;
  authVersion: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface EmailActionRecord {
  kind: "email-action";
  schemaVersion: 1;
  actionId: EmailActionId;
  subjectId: SubjectId;
  purpose: "verify-email" | "recover-password";
  /** Digest of the one-time token. The token itself is never persisted. */
  verifierDigestHex: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export type AuthRecord =
  | SubjectRecord
  | MembershipRecord
  | ApiKeyRecord
  | SessionRecord
  | EmailActionRecord;
export type AuthRecordKind = AuthRecord["kind"];
export type AuthRecordFor<Kind extends AuthRecordKind> = Extract<
  AuthRecord,
  { kind: Kind }
>;

export type AuthAggregate =
  | { kind: "subject"; id: SubjectId }
  | { kind: "membership"; id: MembershipId }
  | { kind: "api-key"; id: ApiKeyId }
  | { kind: "session"; id: SessionId }
  | { kind: "email-action"; id: EmailActionId }
  | { kind: "directory"; id: DirectoryId };

export type AuthActor =
  | { kind: "subject"; subjectId: SubjectId }
  | { kind: "service"; servicePrincipalId: ServicePrincipalId }
  | { kind: "system" };

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AuthEvent {
  schemaVersion: 1;
  eventId: EventId;
  aggregate: AuthAggregate;
  aggregateVersion: number;
  occurredAt: string;
  actor: AuthActor;
  type: string;
  payload: { [key: string]: JsonValue };
}
