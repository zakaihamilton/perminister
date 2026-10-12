import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsFeedback, OrganizationRequestsSection } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import {
  getCurrentSession,
  isAdministrator,
  listPendingOrganizationsForAdministrator,
} from "@/lib/auth/service";
import type { OperationsQuery } from "@/components/operations-types";
import { redirect } from "next/navigation";

export default async function OrganizationRequestsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");

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
