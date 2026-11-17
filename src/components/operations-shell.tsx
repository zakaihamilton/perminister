import type { ReactNode } from "react";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import { DashboardLayoutFrame, type DashboardSidebarProps } from "@/components/dashboard-shell";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import {
  getOperationsPageContext,
  type OperationsPageContext,
} from "@/lib/auth/operations-page-context";
import { countPendingOrganizationsForAdministrator } from "@/lib/auth/service";
import type { DashboardBreadcrumbItem } from "@/lib/dashboard-breadcrumbs";

export async function OperationsShell({
  breadcrumbs,
  children,
  context,
}: {
  breadcrumbs: readonly DashboardBreadcrumbItem[];
  children: ReactNode;
  context?: OperationsPageContext;
}) {
  const pageContext = context ?? (await getOperationsPageContext());
  const { current, organizations, organizationId, selectedOrganization } = pageContext;

  const pendingOrganizationRequestCount = await countPendingOrganizationsForAdministrator(
    current.subject.subjectId,
  ).catch(() => null);
  const sidebarProps: DashboardSidebarProps = {
    organizations,
    organizationId,
    role: selectedOrganization?.membership.role,
    isPlatformAdministrator: true,
    pendingOrganizationRequestCount,
    email: current.subject.primaryEmail,
    firstName: current.subject.firstName ?? null,
    lastName: current.subject.lastName ?? null,
    organizationSwitcher: (
      <OrganizationSwitcher
        organizations={organizations}
        organizationId={organizationId}
        keepOperationsContext
      />
    ),
  };

  return (
    <DashboardLayoutFrame
      sidebarProps={sidebarProps}
      breadcrumbs={<BreadcrumbBar items={breadcrumbs} />}
    >
      {children}
    </DashboardLayoutFrame>
  );
}
