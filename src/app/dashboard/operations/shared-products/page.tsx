import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsFeedback, PublicProductsSection } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import type { OperationsQuery } from "@/components/operations-types";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import { listPublicProductsForAdministrator } from "@/lib/auth/service";
import { operationsBreadcrumbs } from "@/lib/operations-navigation";

export default async function SharedProductsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const query = await searchParams;
  const context = await getOperationsPageContext(query.organizationId);
  const products = await listPublicProductsForAdministrator(context.current.subject.subjectId);

  return (
    <OperationsShell
      context={context}
      breadcrumbs={operationsBreadcrumbs(context.organizationId, "Shared products")}
    >
      <DashboardHeading description="Change the approved organization that publishes a shared product." />
      <OperationsFeedback query={query} />
      <PublicProductsSection
        products={products}
        operationsOrganizationId={context.organizationId}
      />
    </OperationsShell>
  );
}
