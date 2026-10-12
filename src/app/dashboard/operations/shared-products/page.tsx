import { DashboardHeading } from "@/components/dashboard-shell";
import { OperationsFeedback, PublicProductsSection } from "@/components/operations-sections";
import { OperationsShell } from "@/components/operations-shell";
import {
  getCurrentSession,
  isAdministrator,
  listPublicProductsForAdministrator,
} from "@/lib/auth/service";
import type { OperationsQuery } from "@/components/operations-types";
import { redirect } from "next/navigation";

export default async function SharedProductsPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");

  const [products, query] = await Promise.all([
    listPublicProductsForAdministrator(current.subject.subjectId),
    searchParams,
  ]);

  return (
    <OperationsShell
      breadcrumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Platform admin", href: "/dashboard/operations" },
        { label: "Shared products" },
      ]}
    >
      <DashboardHeading description="Change the approved organization that publishes a shared product." />
      <OperationsFeedback query={query} />
      <PublicProductsSection products={products} />
    </OperationsShell>
  );
}
