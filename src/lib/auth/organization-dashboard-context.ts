import "server-only";
import { getCurrentSession } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export async function getOrganizationDashboardRequestContext<SearchParams>(
  params: Promise<{ organizationId: string }>,
  searchParams: Promise<SearchParams>,
) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  return { current, organizationId, query };
}
