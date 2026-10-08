import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getOrganizationForSubject,
  isAdministrator,
  countPendingOrganizationsForAdministrator,
  listProductsForOrganization,
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
  let products: Awaited<ReturnType<typeof listProductsForOrganization>>;
  try {
    [organization, organizations, products] = await Promise.all([
      getOrganizationForSubject(current.subject.subjectId, organizationId),
      listOrganizationsForSubject(current.subject.subjectId),
      listProductsForOrganization(current.subject.subjectId, organizationId),
    ]);
  } catch {
    redirect("/dashboard");
  }
  const isPlatformAdministrator = isAdministrator(current.subject);
  let pendingOrganizationRequestCount: number | null = null;
  if (isPlatformAdministrator) {
    try {
      pendingOrganizationRequestCount = await countPendingOrganizationsForAdministrator(
        current.subject.subjectId,
      );
    } catch {
      pendingOrganizationRequestCount = null;
    }
  }

  return (
    <DashboardShell
      organizationId={organizationId}
      organizationName={organization.organization.name}
      products={products.map(({ productId, name }) => ({ productId, name }))}
      organizations={organizations}
      role={organization.membership.role}
      isPlatformAdministrator={isPlatformAdministrator}
      pendingOrganizationRequestCount={pendingOrganizationRequestCount}
      email={current.subject.primaryEmail}
      firstName={current.subject.firstName ?? null}
      lastName={current.subject.lastName ?? null}
    >
      {children}
    </DashboardShell>
  );
}
