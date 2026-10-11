import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import { DashboardSidebar } from "@/components/dashboard-shell";
import { Brand } from "@/components/site-shell";
import type { DashboardBreadcrumbItem } from "@/lib/dashboard-breadcrumbs";
import {
  countPendingOrganizationsForAdministrator,
  getCurrentSession,
  isAdministrator,
  listOrganizationsForSubject,
} from "@/lib/auth/service";

export async function OperationsShell({
  breadcrumbs,
  children,
}: {
  breadcrumbs: readonly DashboardBreadcrumbItem[];
  children: ReactNode;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");

  const [organizations, pendingOrganizationRequestCount] = await Promise.all([
    listOrganizationsForSubject(current.subject.subjectId),
    countPendingOrganizationsForAdministrator(current.subject.subjectId).catch(() => null),
  ]);
  const organization = organizations[0];
  return (
    <div className="dashboard-layout">
      <DashboardSidebar
        organizations={organizations}
        organizationId={organization?.organization.organizationId}
        role={organization?.membership.role}
        isPlatformAdministrator
        pendingOrganizationRequestCount={pendingOrganizationRequestCount}
        email={current.subject.primaryEmail}
        firstName={current.subject.firstName ?? null}
        lastName={current.subject.lastName ?? null}
      />
      <main className="dashboard-main">
        <div className="dashboard-mobile-brand">
          <Brand />
        </div>
        <div className="dashboard-main-inner">
          <BreadcrumbBar items={breadcrumbs} />
          {children}
        </div>
      </main>
    </div>
  );
}
