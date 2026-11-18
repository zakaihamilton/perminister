import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardHeading } from "@/components/dashboard-shell";
import { EditProductAccessRoleForm } from "@/components/product-access-role-sections";
import { ProductPageNavigation } from "@/components/product-navigation";
import {
  getProductPageContext,
  requireProductManagerRole,
} from "@/lib/auth/product-page-context";

interface EditProductAccessRolePageProps {
  params: Promise<{ organizationId: string; productId: string; accessRoleId: string }>;
}

export default async function EditProductAccessRolePage({
  params,
}: EditProductAccessRolePageProps) {
  const [{ organizationId, productId, access }, routeParams] = await Promise.all([
    getProductPageContext(params),
    params,
  ]);
  requireProductManagerRole(access.membership?.role, organizationId, productId);
  if (access.product.sharedProductRef) notFound();

  const accessRole = (access.product.accessRoles ?? []).find(
    (role) => role.id === routeParams.accessRoleId,
  );
  if (!accessRole) notFound();

  const rolesPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`;

  return (
    <>
      <DashboardHeading
        description="Changes affect future assignments. Existing member permissions stay in place."
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
            <h2>Edit {accessRole.name}</h2>
          </div>
        </div>
        <EditProductAccessRoleForm
          accessRole={accessRole}
          organizationId={organizationId}
          productId={productId}
        />
      </section>
    </>
  );
}
