import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ProductPageNavigation } from "@/components/product-navigation";
import { ProductAccessRoleCatalog } from "@/components/product-access-role-sections";
import {
  getProductManagementPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import Link from "next/link";

export default async function ProductAccessRolesPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ organizationId, productId, access }, query] = await Promise.all([
    getProductManagementPageContext(params),
    searchParams,
  ]);

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
      <p>
        <Link className="button button-secondary" href={`${rolesPath}/catalog`}>
          Import roles from product
        </Link>
      </p>
      {query.notice === "access-role-created" ? (
        <DashboardNotice message="Permission set created." kind="success" />
      ) : null}
      {query.notice === "access-role-updated" ? (
        <DashboardNotice message="Permission set updated." kind="success" />
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
