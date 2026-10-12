import { CopyOrganizationIdButton } from "@/components/copy-organization-id-button";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  OrganizationCreateProductAction,
  OrganizationProductsSection,
} from "@/components/organization-overview-sections";
import { getOrganizationForSubject, listProductsForOrganization } from "@/lib/auth/service";
import {
  getOrganizationDashboardRequestContext,
  type OrganizationDashboardPageProps,
} from "@/lib/auth/organization-dashboard-context";

export default async function OrganizationOverview(
  props: OrganizationDashboardPageProps<{ notice?: string }>,
) {
  const { current, organizationId, query } = await getOrganizationDashboardRequestContext(props);
  const [organization, products] = await Promise.all([
    getOrganizationForSubject(current.subject.subjectId, organizationId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
  ]);
  const canManage =
    organization.membership.role === "owner" || organization.membership.role === "admin";

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
            ? "Manage your products and organization members."
            : "Find the products you can use."
        }
      />
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
      <OrganizationProductsSection
        canManage={canManage}
        organizationId={organizationId}
        products={products}
      />
    </>
  );
}
