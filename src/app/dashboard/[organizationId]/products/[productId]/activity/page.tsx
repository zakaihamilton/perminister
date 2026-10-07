import { DashboardHeading } from "@/components/dashboard-shell";
import { ActivityFeed } from "@/components/activity-feed";
import { getProductPageContext, type ProductPageParams } from "@/lib/auth/product-page-context";
import { listProductAudit } from "@/lib/auth/service";
import { notFound } from "next/navigation";

export default async function ProductActivityPage({ params }: ProductPageParams) {
  const { current, organizationId, productId, access } = await getProductPageContext(params);
  if (!access.membership) notFound();
  const entries = await listProductAudit(current.subject.subjectId, organizationId, productId);
  return (
    <>
      <DashboardHeading description="Recent membership, invitation, grant, and key changes for this product." />
      <ActivityFeed entries={entries} emptyMessage="Product changes will appear here." />
    </>
  );
}
