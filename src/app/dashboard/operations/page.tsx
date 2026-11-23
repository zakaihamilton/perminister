import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsShell } from "@/components/operations-shell";
import type { OperationsQuery } from "@/components/operations-types";
import { PlatformAdminSectionLinks } from "@/components/platform-admin-section-links";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import { organizationDashboardHref } from "@/lib/operations-navigation";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams?: Promise<OperationsQuery>;
}) {
  const query = (await searchParams) ?? {};
  const context = await getOperationsPageContext(query.organizationId);

  return (
    <OperationsShell
      context={context}
      breadcrumbs={[
        { label: "Dashboard", href: organizationDashboardHref(context.organizationId) },
        { label: "Platform admin" },
      ]}
    >
      <DashboardHeading description="Manage shared products, organization requests, older access, and accounts." />
      <PlatformAdminSectionLinks organizationId={context.organizationId} />
    </OperationsShell>
  );
}
