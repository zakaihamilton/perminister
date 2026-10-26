import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs";
import { DashboardShell } from "@/components/dashboard-shell";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { DashboardLayoutSkeleton } from "@/components/dashboard-layout-skeleton";
import {
  getCurrentSession,
  getOrganizationDashboardData,
  getOrganizationForSubject,
  isAdministrator,
} from "@/lib/auth/service";
import type { OrganizationDashboardData } from "@/lib/auth/service";
import { withRequestPerformance } from "@/lib/auth/performance";

type OrganizationDashboardDataPromise = Promise<OrganizationDashboardData>;

export default function OrganizationDashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  return (
    <Suspense fallback={<DashboardLayoutSkeleton />}>
      <LoadedOrganizationDashboardLayout params={params}>
        {children}
      </LoadedOrganizationDashboardLayout>
    </Suspense>
  );
}

async function LoadedOrganizationDashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const [current, { organizationId }] = await Promise.all([getCurrentSession(), params]);
  if (!current) redirect("/login");

  const dashboardData = withRequestPerformance("dashboard.organization-navigation-data", () =>
    getOrganizationDashboardData(current.subject.subjectId, organizationId),
  );
  let organization: Awaited<ReturnType<typeof getOrganizationForSubject>>;
  try {
    organization = await withRequestPerformance("dashboard.organization-access", () =>
      getOrganizationForSubject(current.subject.subjectId, organizationId),
    );
  } catch {
    redirect("/dashboard");
  }

  return (
    <DashboardShell
      organizationId={organizationId}
      organizationName={organization.organization.name}
      organizations={[]}
      sidebarOrganizationSwitcher={
        <Suspense
          fallback={
            <div aria-hidden="true" className="dashboard-skeleton dashboard-skeleton-switcher" />
          }
        >
          <OrganizationSwitcherFromDashboard
            dashboardData={dashboardData}
            organizationId={organizationId}
          />
        </Suspense>
      }
      breadcrumbs={
        <Suspense
          fallback={
            <div aria-hidden="true" className="dashboard-skeleton dashboard-skeleton-breadcrumb" />
          }
        >
          <BreadcrumbsFromDashboard
            dashboardData={dashboardData}
            organizationId={organizationId}
            organizationName={organization.organization.name}
          />
        </Suspense>
      }
      role={organization.membership.role}
      isPlatformAdministrator={isAdministrator(current.subject)}
      pendingOrganizationRequestCount={null}
      email={current.subject.primaryEmail}
      firstName={current.subject.firstName ?? null}
      lastName={current.subject.lastName ?? null}
    >
      {children}
    </DashboardShell>
  );
}

async function OrganizationSwitcherFromDashboard({
  dashboardData,
  organizationId,
}: {
  dashboardData: OrganizationDashboardDataPromise;
  organizationId: string;
}) {
  try {
    const { organizations } = await dashboardData;
    return <OrganizationSwitcher organizations={organizations} organizationId={organizationId} />;
  } catch {
    return null;
  }
}

async function BreadcrumbsFromDashboard({
  dashboardData,
  organizationId,
  organizationName,
}: {
  dashboardData: OrganizationDashboardDataPromise;
  organizationId: string;
  organizationName: string;
}) {
  let products: OrganizationDashboardData["products"] = [];
  try {
    ({ products } = await dashboardData);
  } catch {
    // The current organization name still provides useful breadcrumbs if the catalog read fails.
  }
  return (
    <DashboardBreadcrumbs
      organizationId={organizationId}
      organizationName={organizationName}
      products={products.map(({ productId, name }) => ({ productId, name }))}
    />
  );
}
