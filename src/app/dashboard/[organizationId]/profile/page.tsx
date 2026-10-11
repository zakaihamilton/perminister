import { DashboardHeading } from "@/components/dashboard-shell";
import { ProfileDetailsSection, ProfileNotices } from "@/components/profile-sections";
import { getCurrentSession, isAdministrator } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [current, { organizationId }, query] = await Promise.all([
    getCurrentSession(),
    params,
    searchParams,
  ]);
  if (!current) redirect("/login");

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
