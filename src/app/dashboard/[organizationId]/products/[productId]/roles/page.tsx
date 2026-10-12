import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ProductNavigation } from "@/components/product-navigation";
import {
  CreateProductAccessRoleForm,
  ProductAccessRoleCatalog,
} from "@/components/product-access-role-sections";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import Link from "next/link";

export default async function ProductAccessRolesPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ organizationId, productId, access }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  requireProductManagerRole(access.membership?.role, organizationId, productId);

  const accessRoles = access.product.accessRoles ?? [];
  const accessPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`;

  return (
    <>
      <DashboardHeading
        description="Create permission sets you can reuse for this product."
        action={
          <Link className="button button-secondary" href={accessPath}>
            Assign permissions
          </Link>
        }
      />
      <ProductNavigation
        isSharedInstallation={Boolean(access.product.sharedProductRef)}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        role={access.membership?.role}
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
      >
        <CreateProductAccessRoleForm
          accessRoleCount={accessRoles.length}
          organizationId={organizationId}
          productId={productId}
        />
      </ProductAccessRoleCatalog>
    </>
  );
}
