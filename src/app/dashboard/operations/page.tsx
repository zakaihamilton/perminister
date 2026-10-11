import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsShell } from "@/components/operations-shell";
import {
  AccountsSection,
  LegacyAccessSection,
  OperationsFeedback,
  OrganizationRequestsSection,
  PublicProductsSection,
} from "@/components/operations-sections";
import {
  getCurrentSession,
  isAdministrator,
  listAccountsForAdministrator,
  listPendingOrganizationsForAdministrator,
  listPublicProductsForAdministrator,
  previewLegacyAccessRetirement,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; retired?: string; reason?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");
  const [accounts, organizations, legacy, products, query] = await Promise.all([
    listAccountsForAdministrator(current.subject.subjectId),
    listPendingOrganizationsForAdministrator(current.subject.subjectId),
    previewLegacyAccessRetirement(current.subject.subjectId),
    listPublicProductsForAdministrator(current.subject.subjectId),
    searchParams,
  ]);
  return (
    <OperationsShell
      breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Platform operations" }]}
    >
      <DashboardHeading
        description="Review organization requests, support accounts, and retire unscoped legacy access."
        action={
          <Link className="button button-secondary" href="/dashboard/operations/activity">
            Historical activity
          </Link>
        }
      />
      <OperationsFeedback query={query} />
      <PublicProductsSection products={products} />
      <OrganizationRequestsSection organizations={organizations} />
      <LegacyAccessSection legacy={legacy} />
      <AccountsSection accounts={accounts} />
    </OperationsShell>
  );
}
