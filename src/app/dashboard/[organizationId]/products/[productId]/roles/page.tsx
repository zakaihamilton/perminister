import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
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
        description="Create reusable permission sets for this organization’s product."
        action={
          <Link className="button button-secondary" href={accessPath}>
            Grant access
          </Link>
        }
      />
      {query.notice === "access-role-created" ? (
        <DashboardNotice message="Access role added." kind="success" />
      ) : null}
      {query.notice === "access-role-removed" ? (
        <DashboardNotice message="Access role removed." kind="success" />
      ) : null}
      {query.error === "access-role" ? (
        <DashboardNotice
          message="The access role could not be saved. Use a unique role name and 1–32 valid action names."
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
