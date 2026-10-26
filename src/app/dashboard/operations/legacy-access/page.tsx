import { DashboardHeading } from "@/components/dashboard-shell";
import { LegacyAccessSection, OperationsFeedback } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import { previewLegacyAccessRetirement } from "@/lib/auth/service";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import type { OperationsQuery } from "@/components/operations-types";

export default async function LegacyAccessPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const current = await getOperationsPageContext();

  const [legacy, query] = await Promise.all([
    previewLegacyAccessRetirement(current.subject.subjectId),
    searchParams,
  ]);

  return (
    <OperationsShell
      breadcrumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Platform admin", href: "/dashboard/operations" },
        { label: "Remove older access" },
      ]}
    >
      <DashboardHeading description="Review and remove permissions and API keys that are not linked to an organization." />
      <OperationsFeedback query={query} />
      <LegacyAccessSection legacy={legacy} />
    </OperationsShell>
  );
}
