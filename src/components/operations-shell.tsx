import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import { DashboardNavigation } from "@/components/dashboard-navigation";
import { Brand } from "@/components/site-shell";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { ThemeControl } from "@/components/theme-control";
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
  const displayName = [current.subject.firstName?.trim(), current.subject.lastName?.trim()]
    .filter((name): name is string => !!name)
    .join(" ");

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand-row">
          <Brand />
        </div>
        {organization ? (
          <OrganizationSwitcher
            organizations={organizations}
            organizationId={organization.organization.organizationId}
          />
        ) : null}
        <DashboardNavigation
          organizationId={organization?.organization.organizationId}
          role={organization?.membership.role}
          isPlatformAdministrator
          pendingOrganizationRequestCount={pendingOrganizationRequestCount}
        />
        <div className="dashboard-sidebar-theme">
          <ThemeControl />
        </div>
        <div className="dashboard-sidebar-footer">
          {current.subject.primaryEmail || displayName ? (
            <div className="sidebar-account">
              {current.subject.primaryEmail ? (
                <div className="sidebar-email">{current.subject.primaryEmail}</div>
              ) : null}
              {displayName ? <p className="sidebar-account-name">{displayName}</p> : null}
            </div>
          ) : null}
          <form action={signOutAction}>
            <button className="button button-secondary sidebar-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
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
