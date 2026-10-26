import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsFeedback, PublicProductsSection } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import { listPublicProductsForAdministrator } from "@/lib/auth/service";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import type { OperationsQuery } from "@/components/operations-types";

export default async function SharedProductsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const current = await getOperationsPageContext();

  const [products, query] = await Promise.all([
    listPublicProductsForAdministrator(current.subject.subjectId),
    searchParams,
  ]);

  return (
    <OperationsShell
      breadcrumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Platform admin", href: "/dashboard/operations" },
        { label: "Shared products" },
      ]}
    >
      <DashboardHeading description="Change the approved organization that publishes a shared product." />
      <OperationsFeedback query={query} />
      <PublicProductsSection products={products} />
    </OperationsShell>
  );
}
