import { DashboardHeading } from "@/components/dashboard-shell";
import { ProfileDetailsSection, ProfileNotices } from "@/components/profile-sections";
import { isAdministrator } from "@/lib/auth/service";
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
      <DashboardHeading description="Your Perminister identity is shared across the organizations you belong to." />
      <ProfileNotices error={query.error} notice={query.notice} />
      <ProfileDetailsSection
        isPlatformAdministrator={isAdministrator(current.subject)}
        organizationId={organizationId}
        subject={current.subject}
      />
    </>
  );
}
