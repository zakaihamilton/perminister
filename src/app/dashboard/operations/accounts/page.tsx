import { DashboardHeading } from "@/components/dashboard-shell";
import { AccountsSection, OperationsFeedback } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import type { OperationsQuery } from "@/components/operations-types";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import { listAccountsForAdministrator } from "@/lib/auth/service";
import { operationsBreadcrumbs } from "@/lib/operations-navigation";

export default async function PlatformAccountsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const query = await searchParams;
  const context = await getOperationsPageContext(query.organizationId);
  const accounts = await listAccountsForAdministrator(context.current.subject.subjectId);

  return (
    <OperationsShell
      context={context}
      breadcrumbs={operationsBreadcrumbs(context.organizationId, "Accounts")}
    >
      <DashboardHeading description="View registered accounts and manage their status or access." />
      <OperationsFeedback query={query} />
      <AccountsSection
        accounts={accounts}
        operationsOrganizationId={context.organizationId}
      />
    </OperationsShell>
  );
}
