import type { ProductAccessRole } from "@/lib/auth/access-roles";
import type { ConsumerAuthorizationRequest } from "@/lib/auth/consumer-sso";
import type {
  ApiKeyRecord,
  MembershipId,
  MembershipRecord,
  ProductRecord,
  SessionRecord,
} from "@/lib/auth/domain";
import type {
  ConsumerClientSummary,
  OrganizationActivityEntry,
  OrganizationMemberView,
  OrganizationReviewRequest,
  OrganizationSummary,
  PublicAccount,
} from "@/lib/auth/service";

export const organizationId = "preview-organization";
export const productId = "example-product";
const createdAt = "2026-01-01T00:00:00.000Z";
const orgId = organizationId as ProductRecord["organizationId"];
const subjectId = "preview-alex" as ProductRecord["createdBySubjectId"];

export const client: ConsumerClientSummary = {
  clientId: "preview-client",
  productId,
  appName: "Example app",
  appOrigin: "https://app.example.test",
  redirectUris: ["https://app.example.test/auth/callback"],
  resourceUris: ["https://mcp.example.test"],
  oauthScopes: ["knowledge.read", "knowledge.write"],
  sessionLifetimeMs: 86400000,
  selfRegistrationEnabled: true,
  status: "active",
  createdAt,
  updatedAt: createdAt,
  revokedAt: null,
};

export const consumerAuthorization: ConsumerAuthorizationRequest = {
  clientId: "00000000-0000-4000-8000-000000000011",
  consumerClientId:
    "00000000-0000-4000-8000-000000000012" as ConsumerAuthorizationRequest["consumerClientId"],
  clientName: "Example knowledge app",
  publicClient: true,
  redirectUri: "https://app.example.test/auth/callback",
  resource: "https://mcp.example.test",
  responseType: "code",
  state: "synthetic-preview-state",
  nonce: null,
  scope: "knowledge.read knowledge.write",
  scopes: ["knowledge.read", "knowledge.write"],
  prompt: null,
  codeChallenge: "A".repeat(43),
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

export const accessRoles: ProductAccessRole[] = [
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

export const grants: MembershipRecord[] = [
  {
    kind: "membership",
    schemaVersion: 1,
    membershipId: "preview-grant" as MembershipId,
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
    membershipId: "preview-grant-disabled" as MembershipId,
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

export const apiKeys: ApiKeyRecord[] = [
  {
    kind: "api-key",
    schemaVersion: 1,
    apiKeyId: "preview-key" as ApiKeyRecord["apiKeyId"],
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
    apiKeyId: "preview-key-revoked" as ApiKeyRecord["apiKeyId"],
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

export const productActivity: OrganizationActivityEntry[] = [
  {
    eventId: "preview-product-event" as OrganizationActivityEntry["eventId"],
    type: "grant.created",
    summary: "Granted permissions",
    occurredAt: "2026-10-23T09:00:00Z",
    actor: "Alex Example",
    target: "Sam Example",
    affectedUser: "Sam Example",
    aggregateKind: "membership",
    details: [{ label: "Permission set", value: "Editor" }],
  },
];

const members: OrganizationMemberView[] = [
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
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
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
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  },
];

export const products: ProductRecord[] = [
  {
    kind: "product",
    schemaVersion: 1,
    productRecordId: "preview-product" as ProductRecord["productRecordId"],
    organizationId: orgId,
    productId: "field-notes",
    name: "Field Notes",
    description: "A shared publishing workspace",
    websiteUrl: "https://example.test",
    iconUrl: "",
    visibility: "public",
    createdBySubjectId: subjectId,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

export const previewScreens = [
  "overview",
  "products",
  "members",
  "keys",
  "settings",
  "activity",
  "profile",
  "product-overview",
  "product-move",
  "product-people",
  "product-access",
  "product-roles",
  "product-clients",
  "product-keys",
  "product-activity",
  "product-new",
  "product-role-new",
  "product-role-edit",
  "product-client-new",
  "product-invite",
  "product-access-new",
  "sessions",
  "operations",
  "client-edit",
  "key-new",
  "organization-new",
  "operations-accounts",
  "operations-activity",
  "operations-legacy-access",
  "operations-requests",
  "operations-shared-products",
  "organization-invite",
  "organization-requests",
  "product-key-new",
  "auth-verify",
  "auth-reset",
  "access-denied",
];

export const scenarioOptions = [
  { value: "populated", label: "Populated" },
  { value: "empty", label: "Empty" },
  { value: "role-owner", label: "Owner navigation" },
  { value: "role-admin", label: "Admin navigation" },
  { value: "role-member", label: "Member navigation" },
  { value: "platform-admin", label: "Platform admin navigation" },
  { value: "long-organization-names", label: "Long organization names" },
  { value: "many-records", label: "High-volume lists" },
  { value: "pending-invitation", label: "Pending invitation" },
  { value: "expired-invitation", label: "Expired invitation" },
  { value: "revoked-key", label: "Revoked key" },
  { value: "disabled-grant", label: "Disabled permission" },
  { value: "unverified-account", label: "Unverified account" },
  { value: "validation-errors", label: "Form validation" },
  { value: "permission-set-error", label: "Permission set save error" },
  { value: "access-denied", label: "Access denied" },
  { value: "no-organizations", label: "No organizations" },
] as const;

export type PreviewScenario = (typeof scenarioOptions)[number]["value"];

export const scenarioScreen: Record<string, string> = {
  "access-denied": "access-denied",
  "disabled-grant": "product-access",
  "expired-invitation": "product-people",
  "pending-invitation": "product-people",
  "platform-admin": "operations",
  "permission-set-error": "product-role-edit",
  "revoked-key": "product-keys",
  "unverified-account": "profile",
  "validation-errors": "product-new",
};

function previewPathForScreen(screen: string) {
  const organizationRoot = `/dashboard/${organizationId}`;
  const productRoot = `${organizationRoot}/products/field-notes`;
  const paths: Record<string, string> = {
    overview: organizationRoot,
    products: `${organizationRoot}/products`,
    members: `${organizationRoot}/people`,
    keys: `${organizationRoot}/api-keys`,
    settings: `${organizationRoot}/settings`,
    activity: `${organizationRoot}/activity`,
    profile: `${organizationRoot}/profile`,
    sessions: `${organizationRoot}/sessions`,
    "product-overview": productRoot,
    "product-move": productRoot,
    "product-people": `${productRoot}/people`,
    "product-invite": `${productRoot}/people/invite`,
    "product-access": `${productRoot}/access`,
    "product-access-new": `${productRoot}/access/new`,
    "product-roles": `${productRoot}/roles`,
    "product-role-new": `${productRoot}/roles/new`,
    "product-role-edit": `${productRoot}/roles/preview-editor/edit`,
    "product-clients": `${productRoot}/clients`,
    "product-client-new": `${productRoot}/clients/new`,
    "client-edit": `${productRoot}/clients/preview-client/edit`,
    "product-keys": `${productRoot}/api-keys`,
    "product-key-new": `${productRoot}/api-keys/new`,
    "product-activity": `${productRoot}/activity`,
    "product-new": `${organizationRoot}/products/new`,
    "key-new": `${organizationRoot}/api-keys/new`,
    "organization-requests": "/dashboard/new-organization",
    "organization-new": "/dashboard/new-organization/new",
    operations: "/dashboard/operations",
    "operations-accounts": "/dashboard/operations/accounts",
    "operations-activity": "/dashboard/operations/activity",
    "operations-legacy-access": "/dashboard/operations/legacy-access",
    "operations-requests": "/dashboard/operations/organization-requests",
    "operations-shared-products": "/dashboard/operations/shared-products",
    "access-denied": `${productRoot}/access`,
    "auth-verify": "/verify-email",
    "auth-reset": "/reset-password",
  };
  return paths[screen] ?? organizationRoot;
}

function previewOrganizationSummary(
  id: string,
  name: string,
  membershipIndex: number,
): OrganizationSummary {
  const membership = members[0].membership;
  const organizationIdValue = id as OrganizationSummary["organization"]["organizationId"];
  return {
    organization: {
      kind: "organization",
      schemaVersion: 1,
      organizationId: organizationIdValue,
      name,
      approvalStatus: "approved",
      createdBySubjectId: membership.subjectId,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    membership: {
      ...membership,
      organizationId: organizationIdValue,
      organizationMembershipId:
        `preview-switcher-${membershipIndex}` as OrganizationSummary["membership"]["organizationMembershipId"],
    },
    catalogManager: false,
  };
}

export interface PreviewContext {
  screen: string;
  scenario: PreviewScenario;
  empty: boolean;
  previewRole: "owner" | "admin" | "member";
  isOwner: boolean;
  canManage: boolean;
  isPlatformAdministrator: boolean;
  previewPathname: string;
  organizationName: string;
  previewProducts: ProductRecord[];
  previewMembers: OrganizationMemberView[];
  previewGrants: MembershipRecord[];
  previewApiKeys: ApiKeyRecord[];
  previewProductActivity: OrganizationActivityEntry[];
  previewAccessRoles: ProductAccessRole[];
  invitationExpiry: string;
  previewOrganizations: OrganizationSummary[];
}

export function createPreviewContext(params: {
  scenario?: string;
  screen?: string;
}): PreviewContext {
  const screen =
    params.screen && previewScreens.includes(params.screen) ? params.screen : "overview";
  const scenario = scenarioOptions.some((option) => option.value === params.scenario)
    ? (params.scenario as PreviewScenario)
    : "populated";
  const empty = scenario === "empty";
  const previewRole: "owner" | "admin" | "member" =
    scenario === "role-admin" ? "admin" : scenario === "role-member" ? "member" : "owner";
  const isOwner = previewRole === "owner";
  const canManage = previewRole !== "member";
  const isPlatformAdministrator =
    screen.startsWith("operations") || scenario === "platform-admin";
  const previewPathname =
    scenario === "no-organizations" ? "/dashboard" : previewPathForScreen(screen);
  const isLongNameScenario = scenario === "long-organization-names";
  const organizationName = isLongNameScenario
    ? "Example Studio for Distributed Creative Teams"
    : "Example Studio";
  const previewProducts =
    scenario === "many-records"
      ? [
          ...products,
          ...Array.from({ length: 12 }, (_, index) => ({
            ...products[0],
            productRecordId: `preview-product-${index + 2}` as ProductRecord["productRecordId"],
            productId: `example-product-${index + 2}` as ProductRecord["productId"],
            name: `Example product ${index + 2}`,
          })),
        ]
      : isLongNameScenario
        ? [
            {
              ...products[0],
              name: "Field Notes for Distributed Editorial Teams and Regional Publishers",
            },
          ]
        : products;
  const previewMembers: OrganizationMemberView[] =
    scenario === "many-records"
      ? [
          ...members,
          ...Array.from({ length: 18 }, (_, index) => {
            const baseMember = members[(index + 1) % members.length];
            return {
              ...baseMember,
              email: `member-${String(index + 1).padStart(2, "0")}@example.test`,
              membership: {
                ...baseMember.membership,
                organizationMembershipId:
                  `preview-member-${index + 3}` as OrganizationMemberView["membership"]["organizationMembershipId"],
                subjectId:
                  `preview-subject-${index + 3}` as OrganizationMemberView["membership"]["subjectId"],
                role: "member" as const,
              },
            };
          }),
        ]
      : members;
  const previewGrants =
    scenario === "disabled-grant"
      ? grants.filter((grant) => grant.status === "disabled")
      : grants;
  const previewApiKeys =
    scenario === "revoked-key"
      ? apiKeys.filter((key) => key.status === "revoked")
      : scenario === "many-records"
        ? [
            ...apiKeys,
            ...Array.from({ length: 14 }, (_, index) => ({
              ...apiKeys[0],
              apiKeyId: `preview-key-${index + 3}` as (typeof apiKeys)[number]["apiKeyId"],
            })),
          ]
        : apiKeys;
  const previewProductActivity =
    scenario === "many-records"
      ? Array.from({ length: 24 }, (_, index) => ({
          ...productActivity[0],
          eventId: `preview-product-event-${index + 1}` as OrganizationActivityEntry["eventId"],
          summary: `Updated permissions for member ${index + 1}`,
        }))
      : productActivity;
  const previewAccessRoles =
    scenario === "many-records"
      ? [
          ...accessRoles,
          ...Array.from({ length: 18 }, (_, index) => ({
            ...accessRoles[index % accessRoles.length],
            id: `preview-role-${index + 3}`,
            name: `Application role ${index + 3}`,
            description: `Synthetic permission set for service group ${index + 3}`,
          })),
        ]
      : accessRoles;
  const invitationExpiry =
    scenario === "expired-invitation" ? "2026-01-01T00:00:00Z" : "2027-01-01T00:00:00Z";
  const previewOrganizations = isLongNameScenario
    ? [
        previewOrganizationSummary(organizationId, organizationName, 1),
        previewOrganizationSummary(
          "preview-organization-staging",
          "Example Studio European Production and Review Organization",
          2,
        ),
        previewOrganizationSummary(
          "preview-organization-archive",
          "Example Studio Long-Term Publishing Archive",
          3,
        ),
      ]
    : [previewOrganizationSummary(organizationId, organizationName, 1)];

  return {
    screen,
    scenario,
    empty,
    previewRole,
    isOwner,
    canManage,
    isPlatformAdministrator,
    previewPathname,
    organizationName,
    previewProducts,
    previewMembers,
    previewGrants,
    previewApiKeys,
    previewProductActivity,
    previewAccessRoles,
    invitationExpiry,
    previewOrganizations,
  };
}
