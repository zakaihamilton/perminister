import type { ReactNode } from "react";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import { DashboardShell } from "@/components/dashboard-shell";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import type { DashboardBreadcrumbItem } from "@/lib/dashboard-breadcrumbs";
import type { OrganizationRequestPageContext } from "@/lib/auth/organization-request-page-context";

export function OrganizationRequestPageShell({
  context,
  breadcrumbs,
  children,
}: {
  context: OrganizationRequestPageContext;
  breadcrumbs: readonly DashboardBreadcrumbItem[];
  children: ReactNode;
}) {
  const selected = context.organizations[0];
  if (selected) {
    return (
      <DashboardShell
        organizationId={selected.organization.organizationId}
        organizationName={selected.organization.name}
        organizations={context.organizations}
        role={selected.membership.role}
        isPlatformAdministrator={context.isPlatformAdministrator}
        pendingOrganizationRequestCount={context.pendingOrganizationRequestCount}
        email={context.current.subject.primaryEmail}
        firstName={context.current.subject.firstName ?? null}
        lastName={context.current.subject.lastName ?? null}
      >
        {children}
      </DashboardShell>
    );
  }

  return (
    <>
      <SiteHeader active="dashboard" authenticated />
      <main className="page-shell onboarding-shell">
        <div className="container onboarding-page">
          <BreadcrumbBar items={breadcrumbs} />
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
