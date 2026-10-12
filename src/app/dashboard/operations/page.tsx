import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsShell } from "@/components/operations-shell";
import { PlatformAdminSectionLinks } from "@/components/platform-admin-section-links";
import { getCurrentSession, isAdministrator } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function OperationsPage() {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");

  return (
    <OperationsShell
      breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Platform admin" }]}
    >
      <DashboardHeading description="Manage shared products, organization requests, older access, accounts, and platform activity." />
      <PlatformAdminSectionLinks />
    </OperationsShell>
  );
}
