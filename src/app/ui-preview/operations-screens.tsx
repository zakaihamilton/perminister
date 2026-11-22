import { AccountsSection } from "@/components/accounts-section";
import { ActivityFeed } from "@/components/activity-feed";
import { ActivityPagination } from "@/components/activity-pagination";
import { DashboardHeading } from "@/components/dashboard-shell";
import { LegacyAccessSection } from "@/components/legacy-access-section";
import { OrganizationRequestsSection } from "@/components/organization-requests-section";
import { PlatformAdminSectionLinks } from "@/components/platform-admin-section-links";
import { PublicProductsSection } from "@/components/public-products-section";
import type { OrganizationActivityEntry } from "@/lib/auth/service";
import { accounts, type PreviewContext, products, requests } from "./fixtures";

export function OperationsPreviewScreens({ context }: { context: PreviewContext }) {
  const { screen, empty } = context;

  return (
    <>
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
    </>
  );
}
