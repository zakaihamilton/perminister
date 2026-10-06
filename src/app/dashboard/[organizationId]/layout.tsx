import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listOrganizationsForSubject,
} from "@/lib/auth/service";

export default async function OrganizationDashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const { organizationId } = await params;
  let organization: Awaited<ReturnType<typeof getOrganizationForSubject>>;
  let organizations: Awaited<ReturnType<typeof listOrganizationsForSubject>>;
  try {
    [organization, organizations] = await Promise.all([
      getOrganizationForSubject(current.subject.subjectId, organizationId),
      listOrganizationsForSubject(current.subject.subjectId),
    ]);
  } catch {
    redirect("/dashboard");
  }

  return (
    <DashboardShell
      organizationId={organizationId}
      organizations={organizations}
      role={organization.membership.role}
      email={current.subject.primaryEmail}
    >
      {children}
    </DashboardShell>
  );
}
