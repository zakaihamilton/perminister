import { randomUUID } from "node:crypto";
import type { ProductAccessRole } from "./access-roles";

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type SubjectId = BrandedId<"SubjectId">;
export type MembershipId = BrandedId<"MembershipId">;
export type ApiKeyId = BrandedId<"ApiKeyId">;
export type ServicePrincipalId = BrandedId<"ServicePrincipalId">;
export type EventId = BrandedId<"EventId">;
export type SessionId = BrandedId<"SessionId">;
export type EmailActionId = BrandedId<"EmailActionId">;
export type DirectoryId = BrandedId<"DirectoryId">;
export type OrganizationId = BrandedId<"OrganizationId">;
export type OrganizationMembershipId = BrandedId<"OrganizationMembershipId">;
export type ProductRecordId = BrandedId<"ProductRecordId">;
export type InvitationId = BrandedId<"InvitationId">;

export type OrganizationApprovalStatus = "pending" | "approved" | "rejected";

export const newSubjectId = (): SubjectId => randomUUID() as SubjectId;
export const newMembershipId = (): MembershipId => randomUUID() as MembershipId;
export const newApiKeyId = (): ApiKeyId => randomUUID() as ApiKeyId;
export const newServicePrincipalId = (): ServicePrincipalId => randomUUID() as ServicePrincipalId;
export const newEventId = (): EventId => randomUUID() as EventId;
export const newSessionId = (): SessionId => randomUUID() as SessionId;
export const newEmailActionId = (): EmailActionId => randomUUID() as EmailActionId;
export const newOrganizationId = (): OrganizationId => randomUUID() as OrganizationId;
export const newOrganizationMembershipId = (): OrganizationMembershipId =>
  randomUUID() as OrganizationMembershipId;
export const newProductRecordId = (): ProductRecordId => randomUUID() as ProductRecordId;
export const newInvitationId = (): InvitationId => randomUUID() as InvitationId;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertOpaqueId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Perminister object identifiers must be UUIDs");
  }
}

/** Open product identifier so Perminister stays independent of consumer catalogs. */
export type ProductId = string;

export type ResourceScope =
  | { kind: "product"; organizationId: OrganizationId; productId: ProductId }
  | {
      kind: "project";
      organizationId: OrganizationId;
      productId: ProductId;
      projectId: string;
    }
  | {
      kind: "workspace";
      organizationId: OrganizationId;
      productId: ProductId;
      workspaceId: string;
    };

export interface OrganizationRecord {
  kind: "organization";
  schemaVersion: 1;
  organizationId: OrganizationId;
  name: string;
  /** Missing on records created before platform approval was introduced. */
  approvalStatus?: OrganizationApprovalStatus;
  createdBySubjectId: SubjectId;
  createdAt: string;
  updatedAt: string;
}

export type OrganizationRole = "owner" | "admin" | "member";

export interface OrganizationMembershipRecord {
  kind: "organization-membership";
  schemaVersion: 1;
  organizationMembershipId: OrganizationMembershipId;
  organizationId: OrganizationId;
  /** Absent for an organization catalog manager; present for a product member. */
  productId?: ProductId;
  subjectId: SubjectId;
  role: OrganizationRole;
  status: "active" | "disabled";
  /** Product permission grants are embedded in the product member document. */
  permissionGrants?: MembershipRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductRecord {
  kind: "product";
  schemaVersion: 1;
  productRecordId: ProductRecordId;
  organizationId: OrganizationId;
  productId: ProductId;
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl: string;
  /** Organization-scoped reusable action bundles for this product. */
  accessRoles?: ProductAccessRole[];
  createdBySubjectId: SubjectId;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationInvitationRecord {
  kind: "organization-invitation";
  schemaVersion: 1;
  invitationId: InvitationId;
  organizationId: OrganizationId;
  /** Product-scoped invitations are the only invitations created by the current service. */
  productId?: ProductId;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  verifierDigestHex: string;
  createdBySubjectId: SubjectId;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

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
  /** Optional display snapshot for grants created from a product-published access role. */
  accessRole?: { id: string; name: string };
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface ServicePrincipalRecord {
  kind: "service-principal";
  schemaVersion: 1;
  servicePrincipalId: ServicePrincipalId;
  organizationId: OrganizationId;
  productId: ProductId;
  name: string;
  status: "active" | "disabled";
  createdBySubjectId: SubjectId;
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
  /** Present when this session was created for a consumer application. */
  applicationClientId?: string;
  /** Product audience for consumer application sessions. */
  productId?: ProductId;
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
  | OrganizationRecord
  | OrganizationMembershipRecord
  | ProductRecord
  | OrganizationInvitationRecord
  | SubjectRecord
  | MembershipRecord
  | ServicePrincipalRecord
  | ApiKeyRecord
  | SessionRecord
  | EmailActionRecord;
export type AuthRecordKind = AuthRecord["kind"];
export type AuthRecordFor<Kind extends AuthRecordKind> = Extract<AuthRecord, { kind: Kind }>;

export type AuthAggregate =
  | { kind: "organization"; id: OrganizationId }
  | { kind: "organization-membership"; id: OrganizationMembershipId }
  | { kind: "product"; id: ProductRecordId }
  | { kind: "organization-invitation"; id: InvitationId }
  | { kind: "subject"; id: SubjectId }
  | { kind: "membership"; id: MembershipId }
  | { kind: "service-principal"; id: ServicePrincipalId }
  | { kind: "api-key"; id: ApiKeyId }
  | { kind: "session"; id: SessionId }
  | { kind: "email-action"; id: EmailActionId }
  | { kind: "directory"; id: DirectoryId };

export type AuthActor =
  | { kind: "subject"; subjectId: SubjectId }
  | { kind: "service"; servicePrincipalId: ServicePrincipalId }
  | { kind: "system" };

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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
