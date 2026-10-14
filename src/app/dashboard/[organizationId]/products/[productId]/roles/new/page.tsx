import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductNavigation } from "@/components/product-navigation";
import { CreateProductAccessRoleForm } from "@/components/product-access-role-sections";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageParams,
} from "@/lib/auth/product-page-context";

export default async function NewProductAccessRolePage({ params }: ProductPageParams) {
  const { organizationId, productId, access } = await getProductPageContext(params);
  const role = requireProductManagerRole(access.membership?.role, organizationId, productId);
  if (access.product.sharedProductRef) notFound();
  const rolesPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`;

  return (
    <>
      <DashboardHeading
        description="Define a reusable set of app permission names for this product."
        action={
          <Link className="button button-secondary" href={rolesPath}>
            Back to permission sets
          </Link>
        }
      />
      <ProductNavigation
        isSharedInstallation={Boolean(access.product.sharedProductRef)}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        role={role}
      />
      <section className="dashboard-card access-role-catalog-card">
        <div className="dashboard-card-heading">
          <div>
            <h2>Create permission set</h2>
            <p>Save action names you can assign to product members as a group.</p>
          </div>
        </div>
        <CreateProductAccessRoleForm
          accessRoleCount={(access.product.accessRoles ?? []).length}
          organizationId={organizationId}
          productId={productId}
        />
      </section>
    </>
  );
}
