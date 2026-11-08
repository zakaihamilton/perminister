import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  ArchivedProductCatalog,
  OrganizationProductCatalog,
  OrganizationProductNotices,
  PublicProductCatalog,
} from "@/components/organization-product-sections";
import {
  getOrganizationDashboardData,
  listArchivedProductsForOrganization,
  listPublicProductsForOrganization,
} from "@/lib/auth/service";
import {
  getOrganizationDashboardRequestContext,
  type OrganizationDashboardPageProps,
} from "@/lib/auth/organization-dashboard-context";

export default async function ProductsPage(
  props: OrganizationDashboardPageProps<{ error?: string; notice?: string; reason?: string }>,
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
  const [publicProducts, archivedProducts] = canManage
    ? await Promise.all([
        listPublicProductsForOrganization(current.subject.subjectId, organizationId),
        listArchivedProductsForOrganization(current.subject.subjectId, organizationId),
      ])
    : [[], []];
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
      <OrganizationProductNotices error={query.error} notice={query.notice} reason={query.reason} />
      <OrganizationProductCatalog
        canManage={canManage}
        conflictingSharedProducts={publicProducts.filter(
          (product) => product.status === "conflict",
        )}
        hasArchivedProducts={archivedProducts.length > 0}
        organizationId={organizationId}
        products={products}
      />
      {canManage ? (
        <ArchivedProductCatalog organizationId={organizationId} products={archivedProducts} />
      ) : null}
      {canManage ? (
        <PublicProductCatalog organizationId={organizationId} products={publicProducts} />
      ) : null}
    </>
  );
}
