import { DashboardHeading } from "@/components/dashboard-shell";
import { AccountsSection, OperationsFeedback } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import {
  getCurrentSession,
  isAdministrator,
  listAccountsForAdministrator,
} from "@/lib/auth/service";
import type { OperationsQuery } from "@/components/operations-types";
import { redirect } from "next/navigation";

export default async function PlatformAccountsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");

  const [accounts, query] = await Promise.all([
    listAccountsForAdministrator(current.subject.subjectId),
    searchParams,
  ]);

  return (
    <OperationsShell
      breadcrumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Platform admin", href: "/dashboard/operations" },
        { label: "Accounts" },
      ]}
    >
      <DashboardHeading description="View registered accounts and manage their status or access." />
      <OperationsFeedback query={query} />
      <AccountsSection accounts={accounts} />
    </OperationsShell>
  );
}
