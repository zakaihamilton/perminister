import { notFound } from "next/navigation";
import { DashboardShell, DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { OrganizationOverviewMetrics } from "@/components/organization-overview-metrics";
import { OrganizationPeopleMemberList } from "@/components/people-member-lists";
import type { OrganizationMemberView, OrganizationSummary } from "@/lib/auth/service";
import {
  ArchivedProductCatalog,
  OrganizationProductCatalog,
} from "@/components/organization-product-sections";
import {
  OrganizationApiKeyRecords,
  OrganizationProductKeyLinks,
  ApiKeyAccessHint,
} from "@/components/organization-api-key-sections";
import type { ProductRecord } from "@/lib/auth/domain";
import { OrganizationSettingsForm } from "@/components/organization-settings-form";
import { ActivityFeed } from "@/components/activity-feed";
import { ProfileDetailsSection } from "@/components/profile-sections";
import type { OrganizationActivityEntry } from "@/lib/auth/service";
import { ProductNavigation } from "@/components/product-navigation";
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs";
import { ProductDetailsCard } from "@/components/product-details-card";
import { ProductAccessRoleCatalog } from "@/components/product-access-role-sections";
import { ConsumerClientManager } from "@/components/consumer-client-manager";
import { ProductPeopleSection } from "@/components/product-people-sections";
import { ProductApiKeyRecords } from "@/components/product-api-key-sections";
import { ProductSetupForm } from "@/components/product-setup-form";
import { CreateProductAccessRoleForm } from "@/components/product-access-role-sections";
import { ConsumerClientCreationManager } from "@/components/consumer-client-creation-manager";
import {
  AccessGrantCreationSection,
  ProductAccessGrantCard,
  AccessGrantExplainer,
} from "@/components/product-access-sections";
import { InviteProductMemberSection } from "@/components/product-people-sections";
import { SessionList } from "@/components/session-list";
import { AccountsSection } from "@/components/accounts-section";
import { OrganizationRequestsSection } from "@/components/organization-requests-section";
import { ConsumerClientSettingsForm } from "@/components/consumer-client-settings-form";
import { OrganizationApiKeyCreationSection } from "@/components/organization-api-key-sections";
import { OrganizationRequestSubmission } from "@/components/new-organization-sections";
import { OrganizationProductsSection } from "@/components/organization-overview-products";
import {
  sessions,
  client,
  accounts,
  requests,
  accessRoles,
  grants,
  apiKeys,
  productActivity,
} from "./fixtures";
import { AuthLinkContent } from "@/components/auth-link-pages";
import { PendingInvitations } from "@/components/pending-invitations";
import { OrganizationActivityPreview } from "@/components/organization-overview-activity";
import { PlatformAdminSectionLinks } from "@/components/platform-admin-section-links";
import { LegacyAccessSection } from "@/components/legacy-access-section";
import { PublicProductsSection } from "@/components/public-products-section";
import { ActivityPagination } from "@/components/activity-pagination";
import { InviteOrganizationMemberSection } from "@/components/organization-people-sections";
import { ProductApiKeyCreationSection } from "@/components/product-api-key-sections";
import { OrganizationRequestHistory } from "@/components/new-organization-sections";
import { PreviewGuard } from "./preview-guard";
import { PreviewOrganizationSwitcher } from "./preview-organization-switcher";
import { PreviewDropdown, PreviewToolbar } from "ui-preview-kit";

const organizationId = "preview-organization";
const members: OrganizationMemberView[] = [
  {
    email: "alex@example.test",
    emailVerified: true,
    membership: {
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId:
        "preview-1" as OrganizationMemberView["membership"]["organizationMembershipId"],
      organizationId: organizationId as OrganizationMemberView["membership"]["organizationId"],
      subjectId: "preview-alex" as OrganizationMemberView["membership"]["subjectId"],
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
      organizationId: organizationId as OrganizationMemberView["membership"]["organizationId"],
      subjectId: "preview-sam" as OrganizationMemberView["membership"]["subjectId"],
      role: "admin",
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  },
];

const products: ProductRecord[] = [
  {
    kind: "product",
    schemaVersion: 1,
    productRecordId: "preview-product" as ProductRecord["productRecordId"],
    organizationId: organizationId as ProductRecord["organizationId"],
    productId: "field-notes",
    name: "Field Notes",
    description: "A shared publishing workspace",
    websiteUrl: "https://example.test",
    iconUrl: "",
    visibility: "public",
    createdBySubjectId: "preview-alex" as ProductRecord["createdBySubjectId"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const previewScreens = [
  "overview",
  "products",
  "members",
  "keys",
  "settings",
  "activity",
  "profile",
  "product-overview",
  "product-people",
  "product-access",
  "product-roles",
  "product-clients",
  "product-keys",
  "product-activity",
  "product-new",
  "product-role-new",
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

const scenarioOptions = [
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
  { value: "access-denied", label: "Access denied" },
  { value: "no-organizations", label: "No organizations" },
] as const;

type PreviewScenario = (typeof scenarioOptions)[number]["value"];

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
    "product-people": `${productRoot}/people`,
    "product-invite": `${productRoot}/people/invite`,
    "product-access": `${productRoot}/access`,
    "product-access-new": `${productRoot}/access/new`,
    "product-roles": `${productRoot}/roles`,
    "product-role-new": `${productRoot}/roles/new`,
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
      organizationMembershipId: `preview-switcher-${membershipIndex}` as OrganizationSummary["membership"]["organizationMembershipId"],
    },
    catalogManager: false,
  };
}

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; screen?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.PERMINISTER_UI_PREVIEW !== "1")
    notFound();
  const params = await searchParams;
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
                organizationMembershipId: `preview-member-${index + 3}` as OrganizationMemberView["membership"]["organizationMembershipId"],
                subjectId: `preview-subject-${index + 3}` as OrganizationMemberView["membership"]["subjectId"],
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
  const scenarioScreen: Record<string, string> = {
    "access-denied": "access-denied",
    "disabled-grant": "product-access",
    "expired-invitation": "product-people",
    "pending-invitation": "product-people",
    "platform-admin": "operations",
    "revoked-key": "product-keys",
    "unverified-account": "profile",
    "validation-errors": "product-new",
  };
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
  return (
    <PreviewGuard>
      <DashboardShell
        organizationId={organizationId}
        organizationName={organizationName}
        organizations={previewOrganizations}
        sidebarOrganizationSwitcher={
          <PreviewOrganizationSwitcher
            organizations={previewOrganizations}
            organizationId={organizationId}
          />
        }
        role={previewRole}
        isPlatformAdministrator={isPlatformAdministrator}
        navigationPathname={previewPathname}
        pendingOrganizationRequestCount={null}
        email="alex@example.test"
        firstName="Alex"
        lastName="Example"
        breadcrumbs={
          <DashboardBreadcrumbs
            organizationId={organizationId}
            organizationName={organizationName}
            products={previewProducts.map(({ productId, name }) => ({ productId, name }))}
            pathnameOverride={previewPathname}
          />
        }
      >
        <PreviewToolbar
          variant="card"
          subtitle="Synthetic data · changes are not saved"
          note="Dashboard links and submissions are disabled; filtering and display controls remain interactive."
          utilitiesLabel="Additional preview screens"
          utilities={
            <>
              <a href="/ui-preview/request">Request shell</a>
              <a href="/ui-preview/auth">Authorization and invitation</a>
            </>
          }
        >
          <PreviewDropdown
            label="Screen"
            value={screen}
            options={previewScreens.map((item) => ({
              value: item,
              label: item.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
              href: "/ui-preview?screen=" + encodeURIComponent(item) + "&scenario=" + scenario,
            }))}
          />
          <PreviewDropdown
            label="Scenario"
            value={scenario}
            options={scenarioOptions.map((option) => ({
              value: option.value,
              label: option.label,
              href:
                option.value === "no-organizations"
                  ? "/ui-preview/request?scenario=empty"
                  : "/ui-preview?screen=" +
                    encodeURIComponent(scenarioScreen[option.value] ?? screen) +
                    "&scenario=" +
                    option.value,
            }))}
          />
        </PreviewToolbar>
        {scenario === "access-denied" ? (
          <DashboardNotice
            kind="error"
            message="Perminister denied access to these product permissions. Ask an organization admin to review your role."
          />
        ) : null}
        {scenario === "validation-errors" ? (
          <DashboardNotice
            kind="info"
            message="Validation preview: try submitting this form with the required fields empty or malformed."
          />
        ) : null}
        {scenario === "no-organizations" ? (
          <DashboardNotice
            kind="info"
            message="This account has no organizations yet. Use the request shell to inspect the organization request flow."
          />
        ) : null}
        {(screen?.startsWith("product-") || screen === "access-denied") && (
          <ProductNavigation
            isSharedInstallation={false}
            organizationId={organizationId}
            productId="field-notes"
            productName={previewProducts[0].name}
            role={previewRole}
            pathnameOverride={previewPathname}
          />
        )}
        {screen === "product-new" && (
          <>
            <DashboardHeading description="Start with your website and review the details before adding the product." />
            <ProductSetupForm organizationId={organizationId} />
          </>
        )}
        {screen === "product-role-new" && (
          <>
            <DashboardHeading description="Define a reusable set of app permission names for this product." />
            <section className="dashboard-card access-role-catalog-card">
              <h2>Create permission set</h2>
              <CreateProductAccessRoleForm
                accessRoleCount={0}
                organizationId={organizationId}
                productId="field-notes"
              />
            </section>
          </>
        )}
        {screen === "product-client-new" && (
          <>
            <DashboardHeading description="Connect an app backend to Perminister for Field Notes sign-in and permission checks." />
            <ConsumerClientCreationManager
              organizationId={organizationId}
              productId="field-notes"
              productName="Field Notes"
              returnTo="/ui-preview"
            />
          </>
        )}
        {screen === "product-invite" && (
          <>
            <DashboardHeading description="Invite someone to join Field Notes." />
            <InviteProductMemberSection
              isOwner={isOwner}
              organizationId={organizationId}
              productId="field-notes"
            />
          </>
        )}
        {screen === "product-access-new" && (
          <>
            <DashboardHeading description="Choose a member, define where their permissions apply, and select a permission set or custom actions." />
            <AccessGrantExplainer />
            <AccessGrantCreationSection
              eligibleMembers={empty ? [] : previewMembers}
              organizationId={organizationId}
              productId="field-notes"
              accessRoles={empty ? [] : previewAccessRoles}
            />
          </>
        )}
        {screen === "product-overview" && (
          <>
            <DashboardHeading description={previewProducts[0].description} />
            <ProductDetailsCard
              canManageDetails={canManage}
              initialDialogOpen={false}
              organizationId={organizationId}
              product={previewProducts[0]}
              canManageLifecycle={canManage}
              adopterOrganizations={[{ organizationId: "preview-adopter", name: "Another Studio" }]}
              shareInfo={{
                visibility: "public",
                adopterOrganizations: [
                  { organizationId: "preview-adopter", name: "Another Studio" },
                ],
              }}
              canTransferPublisher={isOwner}
              transferOptions={{
                destinations: [{ organizationId: "preview-destination", name: "Another Studio" }],
              }}
            />
          </>
        )}
        {screen === "product-people" && (
          <>
            <DashboardHeading description="Manage who can use this product and what they can do." />
            <ProductPeopleSection
              isOwner={isOwner}
              members={empty ? [] : previewMembers}
              organizationId={organizationId}
              productId="field-notes"
            />
            <PendingInvitations
              invitations={
                empty
                  ? []
                  : [
                      {
                        invitationId: "preview-invite" as import("@/lib/auth/domain").InvitationId,
                        email: "jordan@example.test",
                        role: "member",
                        expiresAt: invitationExpiry,
                      },
                    ]
              }
              organizationId={organizationId}
              productId="field-notes"
            />
          </>
        )}
        {screen === "product-access" && (
          <>
            <DashboardHeading description="Review and manage what product members can do." />
            {empty ? (
              <section className="dashboard-empty-card">
                <div>
                  <h2>No permissions yet</h2>
                  <p>Add permissions when a member needs to use this product.</p>
                </div>
              </section>
            ) : (
              <div className="access-grant-list">
                {previewGrants.map((grant) => (
                  <ProductAccessGrantCard
                    key={grant.membershipId}
                    grant={grant}
                    email="alex@example.test"
                    productMember={previewMembers[0]}
                    canManage={canManage}
                    organizationId={organizationId}
                    productId="field-notes"
                  />
                ))}
              </div>
            )}
          </>
        )}
        {screen === "product-roles" && (
          <>
            <DashboardHeading description="Manage reusable permission sets for this product." />
            <ProductAccessRoleCatalog
              accessRoles={empty ? [] : previewAccessRoles}
              organizationId={organizationId}
              productId="field-notes"
            />
          </>
        )}
        {screen === "product-clients" && (
          <>
            <DashboardHeading description="Connect Field Notes to Perminister with app client credentials." />
            <ConsumerClientManager
              clients={empty ? [] : [{ ...client, productId: "field-notes" }]}
              organizationId={organizationId}
              productId="field-notes"
              returnTo="/ui-preview"
            />
          </>
        )}
        {screen === "product-keys" && (
          <>
            <DashboardHeading description="Create and manage API keys that work with this product." />
            <ProductApiKeyRecords
              canCreate
              keys={empty ? [] : previewApiKeys}
              now={Date.parse("2026-10-27T00:00:00Z")}
              organizationId={organizationId}
              product={previewProducts[0]}
              returnTo="/ui-preview"
            />
          </>
        )}
        {screen === "product-activity" && (
          <>
            <DashboardHeading description="Recent changes to members, invitations, permissions, and API keys." />
            <ActivityFeed
              entries={empty ? [] : previewProductActivity}
              emptyMessage="Changes to this product will appear here."
            />
          </>
        )}
        {screen === "activity" && (
          <>
            <DashboardHeading description="Recent changes to organization members, products, permissions, and API keys." />
            <ActivityFeed
              entries={
                empty
                  ? []
                  : [
                      {
                        eventId: "preview-event" as OrganizationActivityEntry["eventId"],
                        type: "member.added",
                        summary: "Added a member",
                        occurredAt: "2026-10-23T09:00:00Z",
                        actor: "alex@example.test",
                        target: "sam@example.test",
                        affectedUser: "sam@example.test",
                        aggregateKind: "membership",
                        details: [],
                      },
                    ]
              }
              emptyMessage="Organization changes will appear here."
            />
          </>
        )}
        {screen === "profile" && (
          <>
            <DashboardHeading description="Manage the account details and signed-in devices used across your organizations." />
            <ProfileDetailsSection
              organizationId={organizationId}
              subject={{
                firstName: "Alex",
                lastName: "Example",
                primaryEmail: "alex@example.test",
                emailVerifiedAt:
                  scenario === "unverified-account" ? null : "2026-01-01T00:00:00Z",
                createdAt: "2026-01-01T00:00:00Z",
              }}
            />
          </>
        )}
        {screen === "settings" && (
          <>
            <DashboardHeading description="Update the name shown to members and in invitations." />
            <OrganizationSettingsForm
              organizationId={organizationId}
              organizationName={organizationName}
            />
          </>
        )}
        {screen === "overview" && (
          <DashboardHeading description="Your products, members, and access in one place." />
        )}
        {screen === "products" && (
          <>
            <DashboardHeading description="Manage the products in this organization and the access attached to each one." />
            <OrganizationProductCatalog
              canManage={canManage}
              conflictingSharedProducts={[]}
              hasArchivedProducts={!empty}
              organizationId={organizationId}
              products={empty ? [] : previewProducts}
            />
            {!empty ? (
              <ArchivedProductCatalog
                organizationId={organizationId}
                products={[
                  {
                    product: {
                      ...products[0],
                      productRecordId:
                        "preview-archived-product" as ProductRecord["productRecordId"],
                      productId: "legacy-notes",
                      name: "Legacy Notes",
                      archivedAt: "2026-11-01T00:00:00Z",
                    },
                    adopterOrganizations: [
                      { organizationId: "preview-adopter", name: "Another Studio" },
                    ],
                  },
                ]}
              />
            ) : null}
          </>
        )}
        {screen === "members" && (
          <>
            <DashboardHeading description="Manage organization members." />
            <OrganizationPeopleMemberList
              currentSubjectId="preview-alex"
              members={empty ? [] : previewMembers}
              organizationId={organizationId}
              owner={isOwner}
            />
          </>
        )}
        {screen === "keys" && (
          <>
            <DashboardHeading description="Review this organization’s API keys or create one for a product you can access." />
            <OrganizationApiKeyRecords
              keys={empty ? [] : previewApiKeys}
              now={Date.parse("2026-10-27T00:00:00Z")}
              organizationId={organizationId}
              productNames={new Map([["field-notes", previewProducts[0].name]])}
              returnTo="/ui-preview"
            />
            <OrganizationProductKeyLinks
              organizationId={organizationId}
              products={empty ? [] : previewProducts}
            />
            <ApiKeyAccessHint canCreate={false} hasProducts={!empty} isEmailVerified />
          </>
        )}
        {screen === "overview" && (
          <div className="organization-overview-page">
            <OrganizationOverviewMetrics
              activeApiKeyCount={empty ? 0 : 2}
              memberCount={empty ? 0 : previewMembers.length}
              organizationId={organizationId}
              productCount={empty ? 0 : previewProducts.length}
              role={previewRole}
            />
            <OrganizationProductsSection
              canManage={canManage}
              organizationId={organizationId}
              products={empty ? [] : previewProducts}
            />
            <OrganizationActivityPreview
              entries={empty ? [] : previewProductActivity}
              organizationId={organizationId}
            />
            <OrganizationPeopleMemberList
              currentSubjectId="preview-alex"
              members={empty ? [] : previewMembers}
              organizationId={organizationId}
              owner={isOwner}
            />
          </div>
        )}
        {screen === "sessions" && (
          <>
            <DashboardHeading description="Review signed-in devices." />
            <SessionList
              sessions={empty ? [] : sessions}
              currentSessionId="preview-session"
              returnTo="/ui-preview"
            />
          </>
        )}
        {screen === "operations" && (
          <>
            <DashboardHeading description="Manage shared products, organization requests, older access, accounts, and platform activity." />
            <PlatformAdminSectionLinks />
          </>
        )}
        {screen === "operations-accounts" && (
          <>
            <DashboardHeading description="View registered accounts and manage their status or access." />
            <AccountsSection accounts={empty ? [] : accounts} />
          </>
        )}
        {screen === "operations-requests" && (
          <>
            <DashboardHeading description="Review pending requests to create an organization." />
            <OrganizationRequestsSection organizations={empty ? [] : requests} />
          </>
        )}
        {screen === "operations-legacy-access" && (
          <>
            <DashboardHeading description="Review and remove permissions and API keys that are not linked to an organization." />
            <LegacyAccessSection legacy={empty ? { grants: 0, keys: 0 } : { grants: 3, keys: 2 }} />
          </>
        )}
        {screen === "operations-shared-products" && (
          <>
            <DashboardHeading description="Change the approved organization that publishes a shared product." />
            <PublicProductsSection
              products={
                empty
                  ? []
                  : [
                      {
                        product: products[0],
                        publisherOrganizationName: "Example Studio",
                        adopterCount: 2,
                        destinations: [
                          { organizationId: "preview-destination", name: "Another Studio" },
                        ],
                      },
                    ]
              }
            />
          </>
        )}
        {screen === "operations-activity" && (
          <>
            <ActivityFeed
              entries={
                empty
                  ? []
                  : [
                      {
                        eventId: "platform-event" as OrganizationActivityEntry["eventId"],
                        type: "member.added",
                        summary: "Added a member",
                        occurredAt: "2026-10-23T09:00:00Z",
                        actor: "alex@example.test",
                        target: "sam@example.test",
                        affectedUser: "sam@example.test",
                        aggregateKind: "membership",
                        details: [],
                      },
                    ]
              }
              emptyMessage="No platform activity has been recorded yet."
              showPlatformContext
              title="Activity history"
              description="Recent events across Perminister, including legacy access history."
            />
            <ActivityPagination page={1} totalPages={2} hrefBase="/dashboard/operations/activity" />
          </>
        )}
        {screen === "organization-invite" && (
          <>
            <DashboardHeading description="Send an invitation for someone to join this organization." />
            <InviteOrganizationMemberSection organizationId={organizationId} />
          </>
        )}
        {screen === "organization-requests" && (
          <>
            <DashboardHeading description="Track existing requests or start a request for a new organization." />
            <OrganizationRequestHistory
              requests={
                empty
                  ? []
                  : [
                      {
                        organization: {
                          kind: "organization",
                          schemaVersion: 1,
                          organizationId: products[0].organizationId,
                          name: "Example Studio",
                          approvalStatus: "pending",
                          createdBySubjectId: products[0].createdBySubjectId,
                          createdAt: products[0].createdAt,
                          updatedAt: products[0].updatedAt,
                        },
                        status: "pending",
                      },
                    ]
              }
            />
          </>
        )}
        {screen === "product-key-new" && (
          <>
            <DashboardHeading description="Choose what this key can do and where it can be used." />
            <ProductApiKeyCreationSection
              canCreate
              canManageAccess
              isEmailVerified
              organizationId={organizationId}
              product={products[0]}
              productId="field-notes"
              returnTo="/ui-preview"
            />
          </>
        )}
        {screen === "client-edit" && (
          <>
            <DashboardHeading description="Edit app client settings." />
            <ConsumerClientSettingsForm
              client={{ ...client, productId: "field-notes" }}
              organizationId={organizationId}
              productId="field-notes"
              returnTo="/ui-preview"
              clientsPath="/ui-preview"
            />
          </>
        )}
        {screen === "key-new" && (
          <>
            <DashboardHeading description="Create an API key." />
            <OrganizationApiKeyCreationSection
              canCreate
              organizationId={organizationId}
              products={products}
              returnTo="/ui-preview"
            />
          </>
        )}
        {screen === "organization-new" && (
          <>
            <DashboardHeading description="Request an organization." />
            <OrganizationRequestSubmission emailVerified hasPendingRequest={false} />
          </>
        )}
        {screen === "auth-verify" && (
          <AuthLinkContent kind="verify-email" params={{}} token="synthetic-preview-token" />
        )}
        {screen === "auth-reset" && (
          <AuthLinkContent kind="reset-password" params={{}} token="synthetic-preview-token" />
        )}
      </DashboardShell>
    </PreviewGuard>
  );
}
