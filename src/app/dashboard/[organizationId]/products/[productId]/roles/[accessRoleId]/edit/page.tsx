import { notFound } from "next/navigation";
import {
  ProductAccessRoleFormPage,
  EditProductAccessRoleForm,
} from "@/components/product-access-role-sections";
import { getProductManagementPageContext } from "@/lib/auth/product-page-context";

interface EditProductAccessRolePageProps {
  params: Promise<{ organizationId: string; productId: string; accessRoleId: string }>;
}

export default async function EditProductAccessRolePage({
  params,
}: EditProductAccessRolePageProps) {
  const { organizationId, productId, access } = await getProductManagementPageContext(params);
  const { accessRoleId } = await params;

  const accessRole = (access.product.accessRoles ?? []).find(
    (role) => role.id === accessRoleId,
  );
  if (!accessRole || accessRole.catalogSource) notFound();

  return (
    <ProductAccessRoleFormPage
      access={access}
      description="Changes affect future assignments. Existing member permissions stay in place."
      organizationId={organizationId}
      productId={productId}
      title={`Edit ${accessRole.name}`}
    >
      <EditProductAccessRoleForm
        accessRole={accessRole}
        organizationId={organizationId}
        productId={productId}
      />
    </ProductAccessRoleFormPage>
  );
}
