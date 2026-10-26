import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ProductPageNavigation } from "@/components/product-navigation";
import { ProductAccessRoleCatalog } from "@/components/product-access-role-sections";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function ProductAccessRolesPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ organizationId, productId, access }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  requireProductManagerRole(access.membership?.role, organizationId, productId);
  if (access.product.sharedProductRef) notFound();

  const accessRoles = access.product.accessRoles ?? [];
  const rolesPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`;

  return (
    <>
      <DashboardHeading
        description="Manage reusable permission sets for this product."
        action={
          <Link className="button button-primary" href={`${rolesPath}/new`}>
            Create permission set
          </Link>
        }
      />
      <ProductPageNavigation
        access={access}
        organizationId={organizationId}
        productId={productId}
      />
      {query.notice === "access-role-created" ? (
        <DashboardNotice message="Permission set created." kind="success" />
      ) : null}
      {query.notice === "access-role-removed" ? (
        <DashboardNotice message="Permission set removed." kind="success" />
      ) : null}
      {query.error === "access-role" ? (
        <DashboardNotice
          message="Could not save the permission set. Choose a unique name and use 1–32 valid action names."
          kind="error"
        />
      ) : null}

      <ProductAccessRoleCatalog
        accessRoles={accessRoles}
        organizationId={organizationId}
        productId={productId}
      />
    </>
  );
}
