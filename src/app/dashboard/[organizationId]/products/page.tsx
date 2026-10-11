import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  OrganizationProductCatalog,
  OrganizationProductNotices,
  PublicProductCatalog,
} from "@/components/organization-product-sections";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listPublicProductsForOrganization,
  listProductsForOrganization,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const [organization, products] = await Promise.all([
    getOrganizationForSubject(current.subject.subjectId, organizationId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
  ]);
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
        organizationId={organizationId}
        products={products}
      />
      {canManage ? (
        <PublicProductCatalog organizationId={organizationId} products={publicProducts} />
      ) : null}
    </>
  );
}
