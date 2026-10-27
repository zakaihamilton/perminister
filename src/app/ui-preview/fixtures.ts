import type {
  OrganizationMemberView,
  ConsumerClientSummary,
  PublicAccount,
  OrganizationReviewRequest,
} from "@/lib/auth/service";
import type { ProductRecord, SessionRecord } from "@/lib/auth/domain";

export const organizationId = "preview-organization";
export const productId = "example-product";
const createdAt = "2026-01-01T00:00:00.000Z";
const orgId = organizationId as ProductRecord["organizationId"];
const subjectId = "preview-alex" as ProductRecord["createdBySubjectId"];
export const products: ProductRecord[] = [
  {
    kind: "product",
    schemaVersion: 1,
    productRecordId: "preview-product" as ProductRecord["productRecordId"],
    organizationId: orgId,
    productId: productId as ProductRecord["productId"],
    name: "Example Product",
    description: "A fictional product for previewing access management.",
    websiteUrl: "https://example.test",
    iconUrl: "",
    createdBySubjectId: subjectId,
    createdAt,
    updatedAt: createdAt,
  },
  {
    kind: "product",
    schemaVersion: 1,
    productRecordId: "preview-product-2" as ProductRecord["productRecordId"],
    organizationId: orgId,
    productId: "another-product" as ProductRecord["productId"],
    name: "Another Product",
    description: "A second fictional product.",
    websiteUrl: "https://example.test",
    iconUrl: "",
    createdBySubjectId: subjectId,
    createdAt,
    updatedAt: createdAt,
  },
];
export const members: OrganizationMemberView[] = [
  {
    email: "alex@example.test",
    emailVerified: true,
    membership: {
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId:
        "preview-1" as OrganizationMemberView["membership"]["organizationMembershipId"],
      organizationId: orgId,
      subjectId,
      role: "owner",
      status: "active",
      createdAt,
      updatedAt: createdAt,
    },
  },
  {
    email: "sam.long-name@example.test",
    emailVerified: false,
    membership: {
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId:
        "preview-2" as OrganizationMemberView["membership"]["organizationMembershipId"],
      organizationId: orgId,
      subjectId: "preview-sam" as OrganizationMemberView["membership"]["subjectId"],
      role: "admin",
      status: "active",
      createdAt,
      updatedAt: createdAt,
    },
  },
];
export const client: ConsumerClientSummary = {
  clientId: "preview-client",
  productId,
  appName: "Example app",
  appOrigin: "https://app.example.test",
  sessionLifetimeMs: 86400000,
  selfRegistrationEnabled: true,
  status: "active",
  createdAt,
  updatedAt: createdAt,
  revokedAt: null,
};
export const sessions: SessionRecord[] = [
  {
    kind: "session",
    schemaVersion: 1,
    sessionId: "preview-session" as SessionRecord["sessionId"],
    subjectId,
    verifierDigestHex: "",
    authVersion: 1,
    createdAt,
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: null,
  },
  {
    kind: "session",
    schemaVersion: 1,
    sessionId: "preview-session-2" as SessionRecord["sessionId"],
    subjectId,
    verifierDigestHex: "",
    authVersion: 1,
    applicationClientId: "example-app",
    createdAt,
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: null,
  },
];
export const accounts: PublicAccount[] = [
  {
    subjectId,
    email: "alex@example.test",
    firstName: "Alex",
    lastName: "Example",
    status: "active",
    emailVerified: true,
    administrator: false,
    createdAt,
  },
];
export const requests: OrganizationReviewRequest[] = [
  { organizationId: orgId, name: "Example Studio", requesterEmail: "alex@example.test", createdAt },
];

// Synthetic records only: no usable API key secret is included.
const fieldNotesScope = {
  kind: "product",
  organizationId: orgId,
  productId: "field-notes" as ProductRecord["productId"],
} as const;
export const accessRoles: import("@/lib/auth/access-roles").ProductAccessRole[] = [
  {
    id: "preview-editor",
    name: "Editor",
    description: "Read and update notes",
    actions: ["notes:read", "notes:write"],
  },
  {
    id: "preview-reader",
    name: "Reader",
    description: "Read published notes",
    actions: ["notes:read"],
  },
];
export const grants: import("@/lib/auth/domain").MembershipRecord[] = [
  {
    kind: "membership",
    schemaVersion: 1,
    membershipId: "preview-grant" as import("@/lib/auth/domain").MembershipId,
    subjectId,
    scope: fieldNotesScope,
    grants: [{ scope: fieldNotesScope, actions: ["notes:read", "notes:write"] }],
    accessRole: { id: "preview-editor", name: "Editor" },
    status: "active",
    createdAt,
    updatedAt: createdAt,
  },
  {
    kind: "membership",
    schemaVersion: 1,
    membershipId: "preview-grant-disabled" as import("@/lib/auth/domain").MembershipId,
    subjectId,
    scope: { ...fieldNotesScope, kind: "project", projectId: "spring-campaign" },
    grants: [
      {
        scope: { ...fieldNotesScope, kind: "project", projectId: "spring-campaign" },
        actions: ["notes:read"],
      },
    ],
    status: "disabled",
    createdAt,
    updatedAt: createdAt,
  },
];
export const apiKeys: import("@/lib/auth/domain").ApiKeyRecord[] = [
  {
    kind: "api-key",
    schemaVersion: 1,
    apiKeyId: "preview-key" as import("@/lib/auth/domain").ApiKeyId,
    keyClass: "user",
    owner: { kind: "subject", subjectId },
    scope: fieldNotesScope,
    actions: ["notes:read"],
    verifier: { algorithm: "sha256", digestHex: "" },
    status: "active",
    createdAt,
    expiresAt: null,
    revokedAt: null,
    rotatedFromApiKeyId: null,
  },
  {
    kind: "api-key",
    schemaVersion: 1,
    apiKeyId: "preview-key-revoked" as import("@/lib/auth/domain").ApiKeyId,
    keyClass: "tool",
    owner: { kind: "subject", subjectId },
    scope: { ...fieldNotesScope, kind: "workspace", workspaceId: "design" },
    actions: ["notes:read"],
    verifier: { algorithm: "sha256", digestHex: "" },
    status: "revoked",
    createdAt,
    expiresAt: null,
    revokedAt: createdAt,
    rotatedFromApiKeyId: null,
  },
];
export const productActivity: import("@/lib/auth/service").OrganizationActivityEntry[] = [
  {
    eventId: "preview-product-event" as import("@/lib/auth/domain").EventId,
    type: "grant.created",
    summary: "Added permissions",
    occurredAt: "2026-10-23T09:00:00Z",
    actor: "alex@example.test",
    target: "sam@example.test",
    affectedUser: "sam@example.test",
    aggregateKind: "membership",
    details: [{ label: "Permission set", value: "Editor" }],
  },
];
