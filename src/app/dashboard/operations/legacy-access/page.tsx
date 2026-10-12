import { DashboardHeading } from "@/components/dashboard-shell";
import { LegacyAccessSection, OperationsFeedback } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import {
  getCurrentSession,
  isAdministrator,
  previewLegacyAccessRetirement,
} from "@/lib/auth/service";
import type { OperationsQuery } from "@/components/operations-types";
import { redirect } from "next/navigation";

export default async function LegacyAccessPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");

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
