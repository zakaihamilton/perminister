import { DashboardHeading } from "@/components/dashboard-shell";
import { ProfileDetailsSection, ProfileNotices } from "@/components/profile-sections";
import {
  getOrganizationDashboardRequestContext,
  type OrganizationDashboardPageProps,
} from "@/lib/auth/organization-dashboard-context";

export default async function ProfilePage(
  props: OrganizationDashboardPageProps<{ notice?: string; error?: string }>,
) {
  const { current, organizationId, query } = await getOrganizationDashboardRequestContext(props);

  return (
    <>
      <DashboardHeading description="Manage the account details and signed-in devices used across your organizations." />
      <ProfileNotices error={query.error} notice={query.notice} />
      <ProfileDetailsSection organizationId={organizationId} subject={current.subject} />
    </>
  );
}
