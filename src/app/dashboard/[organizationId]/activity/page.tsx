import { DashboardHeading } from "@/components/dashboard-shell";
import { ActivityFeed } from "@/components/activity-feed";
import { getCurrentSession, getOrganizationActivityPageData } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const [current, { organizationId }] = await Promise.all([getCurrentSession(), params]);
  if (!current) redirect("/login");
  const { role, entries } = await getOrganizationActivityPageData(current.subject, organizationId);
  if (role === "member") redirect(`/dashboard/${organizationId}`);
  return (
    <>
      <DashboardHeading description="Recent changes to organization members, products, permissions, and API keys." />
      <ActivityFeed entries={entries} emptyMessage="Organization changes will appear here." />
    </>
  );
}
