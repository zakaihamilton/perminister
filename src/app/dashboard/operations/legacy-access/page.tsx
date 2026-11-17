import { DashboardHeading } from "@/components/dashboard-shell";
import { LegacyAccessSection, OperationsFeedback } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import { previewLegacyAccessRetirement } from "@/lib/auth/service";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import type { OperationsQuery } from "@/components/operations-types";
import {
  operationsHref,
  organizationDashboardHref,
} from "@/lib/operations-navigation";

export default async function LegacyAccessPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const query = await searchParams;
  const context = await getOperationsPageContext(query.organizationId);
  const legacy = await previewLegacyAccessRetirement(context.current.subject.subjectId);

  return (
    <OperationsShell
      context={context}
      breadcrumbs={[
        { label: "Dashboard", href: organizationDashboardHref(context.organizationId) },
        {
          label: "Platform admin",
          href: operationsHref("/dashboard/operations", context.organizationId),
        },
        { label: "Remove older access" },
      ]}
    >
      <DashboardHeading description="Review and remove permissions and API keys that are not linked to an organization." />
      <OperationsFeedback query={query} />
      <LegacyAccessSection legacy={legacy} />
    </OperationsShell>
  );
}
