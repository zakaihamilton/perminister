import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import {
  DashboardOnboardingNotices,
  OrganizationSetupStep,
  PlatformOperationsLink,
  RejectedOrganizationRequestHistory,
} from "@/components/dashboard-onboarding-sections";
import {
  getCurrentSession,
  isAdministrator,
  countPendingOrganizationsForAdministrator,
  listOrganizationRequestsForSubject,
  listOrganizationsForSubject,
} from "@/lib/auth/service";

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizations = await listOrganizationsForSubject(current.subject.subjectId);
  if (organizations.length) redirect(`/dashboard/${organizations[0].organization.organizationId}`);
  const requests = await listOrganizationRequestsForSubject(current.subject.subjectId);
  const platformAdministrator = isAdministrator(current.subject);
  let pendingOrganizationRequestCount: number | null = null;
  if (platformAdministrator) {
    try {
      pendingOrganizationRequestCount = await countPendingOrganizationsForAdministrator(
        current.subject.subjectId,
      );
    } catch {
      pendingOrganizationRequestCount = null;
    }
  }
  const params = await searchParams;
  const verified = !!current.subject.emailVerifiedAt;
  const pendingRequest = requests.find((request) => request.status === "pending");
  return (
    <>
      <SiteHeader active="dashboard" authenticated />
      <main className="page-shell onboarding-shell">
        <div className="container onboarding-page">
          <BreadcrumbBar items={[{ label: "Set up your organization" }]} />
          <div className="onboarding-intro">
            <div>
              <p className="eyebrow">Welcome to Perminister</p>
              <p className="page-intro">
                Request an organization to manage products, members, and permissions. A platform
                administrator must approve it before you can use it. You can also join an existing
                organization with an invitation.
              </p>
            </div>
            <Image
              alt="An invitation card being added to a folder of team identities."
              className="onboarding-illustration"
              height={1254}
              loading="eager"
              sizes="(max-width: 700px) 38vw, 240px"
              src="/illustrations/workspace-invitation.png"
              width={1254}
            />
          </div>

          <DashboardOnboardingNotices
            email={current.subject.primaryEmail}
            error={params.error}
            notice={params.notice}
          />
          <OrganizationSetupStep pendingRequest={pendingRequest} verified={verified} />
          <RejectedOrganizationRequestHistory requests={requests} />

          <div className="onboarding-secondary">
            <span>Joining an existing team?</span>
            <Link href="/accept-invitation">Open an invitation</Link>
          </div>
          {platformAdministrator ? (
            <PlatformOperationsLink pendingCount={pendingOrganizationRequestCount} />
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
