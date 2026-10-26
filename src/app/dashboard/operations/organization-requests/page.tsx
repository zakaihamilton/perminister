import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsFeedback, OrganizationRequestsSection } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import { listPendingOrganizationsForAdministrator } from "@/lib/auth/service";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import type { OperationsQuery } from "@/components/operations-types";

export default async function OrganizationRequestsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const current = await getOperationsPageContext();

  const [organizations, query] = await Promise.all([
    listPendingOrganizationsForAdministrator(current.subject.subjectId),
    searchParams,
  ]);

  return (
    <OperationsShell
      breadcrumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Platform admin", href: "/dashboard/operations" },
        { label: "Organization requests" },
      ]}
    >
      <DashboardHeading description="Review pending requests to create an organization." />
      <OperationsFeedback query={query} />
      <OrganizationRequestsSection organizations={organizations} />
    </OperationsShell>
  );
}
