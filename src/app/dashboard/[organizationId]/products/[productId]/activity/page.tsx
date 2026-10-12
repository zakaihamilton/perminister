import { DashboardHeading } from "@/components/dashboard-shell";
import { ActivityFeed } from "@/components/activity-feed";
import { ProductNavigation } from "@/components/product-navigation";
import { getProductPageContext, type ProductPageParams } from "@/lib/auth/product-page-context";
import { listProductAudit } from "@/lib/auth/service";
import { notFound } from "next/navigation";

export default async function ProductActivityPage({ params }: ProductPageParams) {
  const { current, organizationId, productId, access } = await getProductPageContext(params);
  if (!access.membership) notFound();
  const entries = await listProductAudit(current.subject.subjectId, organizationId, productId);
  return (
    <>
      <DashboardHeading description="Recent changes to members, invitations, permissions, and API keys." />
      <ProductNavigation
        isSharedInstallation={Boolean(access.product.sharedProductRef)}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        role={access.membership.role}
      />
      <ActivityFeed entries={entries} emptyMessage="Changes to this product will appear here." />
    </>
  );
}
