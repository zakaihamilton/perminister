import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsFeedback, OrganizationRequestsSection } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import type { OperationsQuery } from "@/components/operations-types";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import { listPendingOrganizationsForAdministrator } from "@/lib/auth/service";
import {
  operationsHref,
  organizationDashboardHref,
} from "@/lib/operations-navigation";

export default async function OrganizationRequestsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const query = await searchParams;
  const context = await getOperationsPageContext(query.organizationId);
  const organizations = await listPendingOrganizationsForAdministrator(
    context.current.subject.subjectId,
  );

  return (
    <OperationsShell
      context={context}
      breadcrumbs={[
        { label: "Dashboard", href: organizationDashboardHref(context.organizationId) },
        {
          label: "Platform admin",
          href: operationsHref("/dashboard/operations", context.organizationId),
        },
        { label: "Organization requests" },
      ]}
    >
      <DashboardHeading description="Review pending requests to create an organization." />
      <OperationsFeedback query={query} />
      <OrganizationRequestsSection
        organizations={organizations}
        operationsOrganizationId={context.organizationId}
      />
    </OperationsShell>
  );
}
