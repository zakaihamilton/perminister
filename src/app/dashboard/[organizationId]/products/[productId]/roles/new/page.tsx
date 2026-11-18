import {
  CreateProductAccessRoleForm,
  ProductAccessRoleFormPage,
} from "@/components/product-access-role-sections";
import {
  getProductManagementPageContext,
  type ProductPageParams,
} from "@/lib/auth/product-page-context";

export default async function NewProductAccessRolePage({ params }: ProductPageParams) {
  const { organizationId, productId, access } = await getProductManagementPageContext(params);

  return (
    <ProductAccessRoleFormPage
      access={access}
      description="Define a reusable set of app permission names for this product."
      organizationId={organizationId}
      productId={productId}
      title="Create permission set"
      titleDescription="Save action names you can assign to product members as a group."
    >
      <CreateProductAccessRoleForm
        accessRoleCount={
          (access.product.accessRoles ?? []).filter((role) => !role.deprecated).length
        }
        organizationId={organizationId}
        productId={productId}
      />
    </ProductAccessRoleFormPage>
  );
}
