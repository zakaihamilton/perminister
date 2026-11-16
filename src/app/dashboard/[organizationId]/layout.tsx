import { skeletonClasses } from "@/components/skeleton-classnames";
import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs";
import { DashboardShell } from "@/components/dashboard-shell";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { DashboardLayoutSkeleton } from "@/components/dashboard-layout-skeleton";
import {
  getCurrentSession,
  getOrganizationForSubject,
  isAdministrator,
  listOrganizationSwitcherData,
  listProductsForOrganization,
} from "@/lib/auth/service";
import type { OrganizationSummary } from "@/lib/auth/service";
import type { ProductRecord } from "@/lib/auth/domain";
import { withRequestPerformance } from "@/lib/auth/performance";

type OrganizationSwitcherDataPromise = Promise<OrganizationSummary[]>;
type BreadcrumbProductsPromise = Promise<ProductRecord[]>;

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

  let organization: Awaited<ReturnType<typeof getOrganizationForSubject>>;
  try {
    organization = await withRequestPerformance("dashboard.organization-access", () =>
      getOrganizationForSubject(current.subject.subjectId, organizationId),
    );
  } catch {
    redirect("/dashboard");
  }
  const organizationSwitcherData = withRequestPerformance(
    "dashboard.organization-switcher-data",
    () => listOrganizationSwitcherData(current.subject.subjectId, organizationId),
  );
  const breadcrumbProducts = withRequestPerformance(
    "dashboard.organization-breadcrumb-products",
    () => listProductsForOrganization(current.subject.subjectId, organizationId),
  );

  return (
    <DashboardShell
      organizationId={organizationId}
      organizationName={organization.organization.name}
      organizations={[]}
      sidebarOrganizationSwitcher={
        <Suspense
          fallback={
            <div aria-hidden="true" className={skeletonClasses("dashboard-skeleton-switcher")} />
          }
        >
          <OrganizationSwitcherFromDashboard
            organizationSwitcherData={organizationSwitcherData}
            organizationId={organizationId}
          />
        </Suspense>
      }
      breadcrumbs={
        <Suspense
          fallback={
            <div aria-hidden="true" className={skeletonClasses("dashboard-skeleton-breadcrumb")} />
          }
        >
          <BreadcrumbsFromDashboard
            breadcrumbProducts={breadcrumbProducts}
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
  organizationSwitcherData,
  organizationId,
}: {
  organizationSwitcherData: OrganizationSwitcherDataPromise;
  organizationId: string;
}) {
  const organizations = await organizationSwitcherData.catch(() => null);
  if (!organizations) return null;
  return <OrganizationSwitcher organizations={organizations} organizationId={organizationId} />;
}

async function BreadcrumbsFromDashboard({
  breadcrumbProducts,
  organizationId,
  organizationName,
}: {
  breadcrumbProducts: BreadcrumbProductsPromise;
  organizationId: string;
  organizationName: string;
}) {
  let products: ProductRecord[] = [];
  try {
    products = await breadcrumbProducts;
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
