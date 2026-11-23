import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  AccessGrantCreationSection,
  AccessGrantExplainer,
} from "@/components/product-access-sections";
import { ProductPageNavigation } from "@/components/product-navigation";
import {
  getProductPageContext,
  type ProductPageParams,
  requireProductManagerRole,
} from "@/lib/auth/product-page-context";
import { listProductMembers } from "@/lib/auth/service";

export default async function NewProductPermissionPage({ params }: ProductPageParams) {
  const { current, organizationId, productId, access } = await getProductPageContext(params);
  requireProductManagerRole(access.membership?.role, organizationId, productId);
  const members = await listProductMembers(current.subject.subjectId, organizationId, productId, {
    includeDisabled: true,
  });
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
      <ProductPageNavigation
        access={access}
        organizationId={organizationId}
        productId={productId}
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
