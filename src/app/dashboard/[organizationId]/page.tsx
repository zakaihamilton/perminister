import { CopyOrganizationIdButton } from "@/components/copy-organization-id-button";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  OrganizationCreateProductAction,
  OrganizationActivityPreview,
  OrganizationOverviewMetrics,
  OrganizationProductsSection,
} from "@/components/organization-overview-sections";
import {
  countOrganizationMembersForSubject,
  getOrganizationForSubject,
  listApiKeysForSubject,
  listOrganizationAudit,
  listProductsForOrganization,
} from "@/lib/auth/service";
import {
  getOrganizationDashboardRequestContext,
  type OrganizationDashboardPageProps,
} from "@/lib/auth/organization-dashboard-context";

export default async function OrganizationOverview(
  props: OrganizationDashboardPageProps<{ notice?: string }>,
) {
  const { current, organizationId, query } = await getOrganizationDashboardRequestContext(props);
  const [organization, products, apiKeys] = await Promise.all([
    getOrganizationForSubject(current.subject.subjectId, organizationId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
    listApiKeysForSubject(current.subject.subjectId),
  ]);
  const canManage =
    organization.membership.role === "owner" || organization.membership.role === "admin";
  const managerOverview = canManage
    ? await Promise.all([
        countOrganizationMembersForSubject(current.subject.subjectId, organizationId),
        listOrganizationAudit(current.subject.subjectId, organizationId, 4),
      ])
    : null;
  const now =
    // eslint-disable-next-line react-hooks/purity
    Date.now();
  const activeApiKeyCount = apiKeys.filter(
    (key) =>
      key.scope.organizationId === organizationId &&
      key.status === "active" &&
      (!key.expiresAt || Date.parse(key.expiresAt) > now),
  ).length;

  return (
    <>
      <DashboardHeading
        action={
          <OrganizationCreateProductAction
            canManage={canManage}
            hasProducts={products.length > 0}
            organizationId={organizationId}
          />
        }
        description={
          canManage
            ? "Your products, members, and access in one place."
            : "Open the products you can access in this organization."
        }
      />
      <div className="organization-overview-page">
        <div className="organization-id-inline">
          <span>Organization ID</span>
          <CopyOrganizationIdButton organizationId={organizationId} />
        </div>
        {query.notice === "invitation-accepted" ? (
          <DashboardNotice
            message="You joined the product. Open Products to see your permissions."
            kind="success"
          />
        ) : null}
        <OrganizationOverviewMetrics
          activeApiKeyCount={activeApiKeyCount}
          memberCount={managerOverview?.[0] ?? null}
          organizationId={organizationId}
          productCount={products.length}
          role={organization.membership.role}
        />
        <div className={`organization-overview-grid${managerOverview ? "" : " is-products-only"}`}>
          <OrganizationProductsSection
            canManage={canManage}
            organizationId={organizationId}
            products={products}
          />
          {managerOverview ? (
            <OrganizationActivityPreview
              entries={managerOverview[1]}
              organizationId={organizationId}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
