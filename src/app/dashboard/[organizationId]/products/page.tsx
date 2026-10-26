import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  OrganizationProductCatalog,
  OrganizationProductNotices,
  PublicProductCatalog,
} from "@/components/organization-product-sections";
import {
  getOrganizationDashboardData,
  listPublicProductsForOrganization,
} from "@/lib/auth/service";
import {
  getOrganizationDashboardRequestContext,
  type OrganizationDashboardPageProps,
} from "@/lib/auth/organization-dashboard-context";

export default async function ProductsPage(
  props: OrganizationDashboardPageProps<{ error?: string; notice?: string }>,
) {
  const { current, organizationId, query } = await getOrganizationDashboardRequestContext(props);
  const dashboardData = await getOrganizationDashboardData(
    current.subject.subjectId,
    organizationId,
  );
  const { organization, products } = dashboardData;
  const canManage =
    organization.catalogManager &&
    (organization.membership.role === "owner" || organization.membership.role === "admin");
  const publicProducts = canManage
    ? await listPublicProductsForOrganization(current.subject.subjectId, organizationId)
    : [];
  return (
    <>
      <DashboardHeading
        description="Manage the products in this organization and the access attached to each one."
        action={
          canManage ? (
            <Link
              className="button button-primary"
              href={`/dashboard/${organizationId}/products/new`}
            >
              Create product
            </Link>
          ) : undefined
        }
      />
      <OrganizationProductNotices error={query.error} notice={query.notice} />
      <OrganizationProductCatalog
        canManage={canManage}
        conflictingSharedProducts={publicProducts.filter(
          (product) => product.status === "conflict",
        )}
        organizationId={organizationId}
        products={products}
      />
      {canManage ? (
        <PublicProductCatalog organizationId={organizationId} products={publicProducts} />
      ) : null}
    </>
  );
}
