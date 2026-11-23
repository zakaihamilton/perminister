import "server-only";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/service";

export type OrganizationDashboardPageProps<SearchParams extends object> = {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<SearchParams>;
};

export async function getOrganizationDashboardRequestContext<SearchParams extends object>({
  params,
  searchParams,
}: OrganizationDashboardPageProps<SearchParams>) {
  const [current, { organizationId }, query] = await Promise.all([
    getCurrentSession(),
    params,
    searchParams,
  ]);
  if (!current) redirect("/login");
  return { current, organizationId, query };
}
