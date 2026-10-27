import { notFound } from "next/navigation";
import { DashboardShell, DashboardHeading } from "@/components/dashboard-shell";
import { OrganizationOverviewMetrics } from "@/components/organization-overview-metrics";
import { OrganizationPeopleMemberList } from "@/components/people-member-lists";
import type { OrganizationMemberView } from "@/lib/auth/service";
import { OrganizationProductCatalog } from "@/components/organization-product-sections";
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
];

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; screen?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.PERMINISTER_UI_PREVIEW !== "1")
    notFound();
  const params = await searchParams;
  const screen = previewScreens.includes(params.screen ?? "") ? params.screen : "overview";
  const scenario = params.scenario === "empty" ? "empty" : "populated";
  const empty = scenario === "empty";
  const previewRole = "owner" as const;
  return (
    <PreviewGuard>
      <DashboardShell
        organizationId={organizationId}
        organizationName="Example Studio"
        organizations={[]}
        role={previewRole}
        isPlatformAdministrator={Boolean(screen?.startsWith("operations"))}
        pendingOrganizationRequestCount={null}
        email="alex@example.test"
        firstName="Alex"
        lastName="Example"
        breadcrumbs={<p>Preview / Example Studio</p>}
      >
        <div className="ui-preview-toolbar">
          <strong>UI preview · synthetic data</strong>{" "}
          <nav aria-label="Preview screens">
            {previewScreens.map((item) => (
              <a
                key={item}
                href={`/ui-preview?screen=${item}&scenario=${scenario}`}
                aria-current={screen === item ? "page" : undefined}
                style={{ marginRight: 16 }}
              >
                {item}
              </a>
            ))}
          </nav>
          <a
            href={`/ui-preview?screen=${screen}&scenario=populated`}
            aria-current={!empty ? "page" : undefined}
          >
            Populated
          </a>
          {" · "}
          <a
            href={`/ui-preview?screen=${screen}&scenario=empty`}
            aria-current={empty ? "page" : undefined}
          >
            Empty
          </a>
          <p>
            <a href="/ui-preview/request">No-organization request shell</a>
            {" · "}
            <a href="/ui-preview/auth">Authorization and invitation</a>
          </p>
          <p>
            Navigation and submissions inside the dashboard are disabled. Filtering and display
            controls remain interactive.
          </p>
        </div>
        {screen?.startsWith("product-") && (
          <ProductNavigation
            isSharedInstallation={false}
            organizationId={organizationId}
            productId="field-notes"
            productName="Field Notes"
            role={previewRole}
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
              clientsPath="/ui-preview"
            />
          </>
        )}
        {screen === "product-invite" && (
          <>
            <DashboardHeading description="Invite someone to join Field Notes." />
            <InviteProductMemberSection
              isOwner
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
              eligibleMembers={empty ? [] : members}
              organizationId={organizationId}
              productId="field-notes"
              accessRoles={empty ? [] : accessRoles}
            />
          </>
        )}
        {screen === "product-overview" && (
          <>
            <DashboardHeading description={products[0].description} />
            <ProductDetailsCard
              canManageDetails
              initialDialogOpen={false}
              organizationId={organizationId}
              product={products[0]}
              shareInfo={{
                visibility: "public",
                adopterOrganizations: [
                  { organizationId: "preview-adopter", name: "Another Studio" },
                ],
              }}
              canTransferPublisher
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
              isOwner
              members={empty ? [] : members}
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
                        expiresAt: "2027-01-01T00:00:00Z",
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
                {grants.map((grant) => (
                  <ProductAccessGrantCard
                    key={grant.membershipId}
                    grant={grant}
                    email="alex@example.test"
                    productMember={members[0]}
                    canManage
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
              accessRoles={empty ? [] : accessRoles}
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
              keys={empty ? [] : apiKeys}
              now={Date.parse("2026-10-27T00:00:00Z")}
              organizationId={organizationId}
              product={products[0]}
              returnTo="/ui-preview"
            />
          </>
        )}
        {screen === "product-activity" && (
          <>
            <DashboardHeading description="Recent changes to members, invitations, permissions, and API keys." />
            <ActivityFeed
              entries={empty ? [] : productActivity}
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
                emailVerifiedAt: "2026-01-01T00:00:00Z",
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
              organizationName="Example Studio"
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
              canManage
              conflictingSharedProducts={[]}
              organizationId={organizationId}
              products={empty ? [] : products}
            />
          </>
        )}
        {screen === "members" && (
          <>
            <DashboardHeading description="Manage organization members." />
            <OrganizationPeopleMemberList
              currentSubjectId="preview-alex"
              members={empty ? [] : members}
              organizationId={organizationId}
              owner
            />
          </>
        )}
        {screen === "keys" && (
          <>
            <DashboardHeading description="Review this organization’s API keys or create one for a product you can access." />
            <OrganizationApiKeyRecords
              keys={empty ? [] : apiKeys}
              now={Date.parse("2026-10-27T00:00:00Z")}
              organizationId={organizationId}
              productNames={new Map([["field-notes", "Field Notes"]])}
              returnTo="/ui-preview"
            />
            <OrganizationProductKeyLinks
              organizationId={organizationId}
              products={empty ? [] : products}
            />
            <ApiKeyAccessHint canCreate={false} hasProducts={!empty} isEmailVerified />
          </>
        )}
        {screen === "overview" && (
          <div className="organization-overview-page">
            <OrganizationOverviewMetrics
              activeApiKeyCount={empty ? 0 : 2}
              memberCount={empty ? 0 : members.length}
              organizationId={organizationId}
              productCount={empty ? 0 : products.length}
              role={previewRole}
            />
            <OrganizationProductsSection
              canManage
              organizationId={organizationId}
              products={empty ? [] : products}
            />
            <OrganizationActivityPreview
              entries={empty ? [] : productActivity}
              organizationId={organizationId}
            />
            <OrganizationPeopleMemberList
              currentSubjectId="preview-alex"
              members={empty ? [] : members}
              organizationId={organizationId}
              owner
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
