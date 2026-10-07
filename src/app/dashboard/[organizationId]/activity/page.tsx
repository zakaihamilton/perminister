import { DashboardHeading } from "@/components/dashboard-shell";
import { ActivityFeed } from "@/components/activity-feed";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listOrganizationAudit,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const [current, { organizationId }] = await Promise.all([getCurrentSession(), params]);
  if (!current) redirect("/login");
  const organization = await getOrganizationForSubject(current.subject.subjectId, organizationId);
  if (organization.membership.role === "member") redirect(`/dashboard/${organizationId}`);
  const entries = await listOrganizationAudit(current.subject.subjectId, organizationId);
  return (
    <>
      <DashboardHeading description="Recent changes to organization membership, products, grants, and keys." />
      <ActivityFeed entries={entries} emptyMessage="Organization changes will appear here." />
    </>
  );
}
