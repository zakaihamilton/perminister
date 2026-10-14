import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductNavigation } from "@/components/product-navigation";
import { InviteProductMemberSection } from "@/components/product-people-sections";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageParams,
} from "@/lib/auth/product-page-context";

export default async function InviteProductMemberPage({ params }: ProductPageParams) {
  const { organizationId, productId, access } = await getProductPageContext(params);
  const role = requireProductManagerRole(access.membership?.role, organizationId, productId);
  const peoplePath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`;

  return (
    <>
      <DashboardHeading
        description={`Invite someone to join ${access.product.name}.`}
        action={
          <Link className="button button-secondary" href={peoplePath}>
            Back to members
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
      <InviteProductMemberSection
        isOwner={role === "owner"}
        organizationId={organizationId}
        productId={productId}
      />
    </>
  );
}
