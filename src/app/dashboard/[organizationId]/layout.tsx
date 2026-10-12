import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getOrganizationDashboardData,
  isAdministrator,
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
  const isPlatformAdministrator = isAdministrator(current.subject);
  let dashboardData: Awaited<ReturnType<typeof getOrganizationDashboardData>>;
  try {
    dashboardData = await getOrganizationDashboardData(current.subject.subjectId, organizationId);
  } catch {
    redirect("/dashboard");
  }
  const { organization, organizations, products } = dashboardData;

  return (
    <DashboardShell
      organizationId={organizationId}
      organizationName={organization.organization.name}
      products={products.map(({ productId, name }) => ({ productId, name }))}
      organizations={organizations}
      role={organization.membership.role}
      isPlatformAdministrator={isPlatformAdministrator}
      pendingOrganizationRequestCount={null}
      email={current.subject.primaryEmail}
      firstName={current.subject.firstName ?? null}
      lastName={current.subject.lastName ?? null}
    >
      {children}
    </DashboardShell>
  );
}
