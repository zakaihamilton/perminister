import Link from "next/link";
import {
  AccessGrantCreationSection,
  AccessGrantExplainer,
} from "@/components/product-access-sections";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductNavigation } from "@/components/product-navigation";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageParams,
} from "@/lib/auth/product-page-context";
import { listProductMembers } from "@/lib/auth/service";

export default async function NewProductPermissionPage({ params }: ProductPageParams) {
  const { current, organizationId, productId, access } = await getProductPageContext(params);
  const role = requireProductManagerRole(access.membership?.role, organizationId, productId);
  const members = await listProductMembers(
    current.subject.subjectId,
    organizationId,
    productId,
    { includeDisabled: true },
  );
  const eligibleMembers = members.filter(
    (member) => member.emailVerified && member.membership.status === "active",
  );
  const accessPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`;

  return (
    <>
      <DashboardHeading
        description="Choose a member, define where their permissions apply, and select a permission set or custom actions."
        action={
          <Link className="button button-secondary" href={accessPath}>
            Back to permissions
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
      <AccessGrantExplainer />
      <AccessGrantCreationSection
        eligibleMembers={eligibleMembers}
        organizationId={organizationId}
        productId={productId}
        accessRoles={access.product.accessRoles ?? []}
      />
    </>
  );
}
