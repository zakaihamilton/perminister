import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductPageNavigation } from "@/components/product-navigation";
import { CreateProductAccessRoleForm } from "@/components/product-access-role-sections";
import {
  getProductManagementPageContext,
  type ProductPageParams,
} from "@/lib/auth/product-page-context";

export default async function NewProductAccessRolePage({ params }: ProductPageParams) {
  const { organizationId, productId, access } = await getProductManagementPageContext(params);
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
      <ProductPageNavigation
        access={access}
        organizationId={organizationId}
        productId={productId}
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
