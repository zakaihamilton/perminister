import { ActivityFeed } from "@/components/activity-feed";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  OrganizationRequestHistory,
  OrganizationRequestSubmission,
} from "@/components/new-organization-sections";
import {
  ApiKeyAccessHint,
  OrganizationApiKeyCreationSection,
  OrganizationApiKeyRecords,
  OrganizationProductKeyLinks,
} from "@/components/organization-api-key-sections";
import { OrganizationActivityPreview } from "@/components/organization-overview-activity";
import { OrganizationOverviewMetrics } from "@/components/organization-overview-metrics";
import { OrganizationProductsSection } from "@/components/organization-overview-products";
import { InviteOrganizationMemberSection } from "@/components/organization-people-sections";
import {
  ArchivedProductCatalog,
  OrganizationProductCatalog,
} from "@/components/organization-product-sections";
import { OrganizationSettingsForm } from "@/components/organization-settings-form";
import { OrganizationPeopleMemberList } from "@/components/people-member-lists";
import { ProfileDetailsSection } from "@/components/profile-sections";
import { SessionList } from "@/components/session-list";
import type { ProductRecord } from "@/lib/auth/domain";
import type { OrganizationActivityEntry } from "@/lib/auth/service";
import { organizationId, type PreviewContext, products, sessions } from "./fixtures";

export function OrganizationPreviewScreens({ context }: { context: PreviewContext }) {
  const {
    screen,
    scenario,
    empty,
    previewRole,
    isOwner,
    canManage,
    organizationName,
    previewProducts,
    previewMembers,
    previewApiKeys,
    previewProductActivity,
  } = context;

  return (
    <>
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
        <>
          <DashboardHeading description="Your products, members, and access in one place." />
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
        </>
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
    </>
  );
}
