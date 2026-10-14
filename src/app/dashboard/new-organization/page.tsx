import Link from "next/link";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import { DashboardHeading, DashboardShell } from "@/components/dashboard-shell";
import {
  DashboardOnboardingNotices,
  OrganizationSetupStep,
} from "@/components/dashboard-onboarding-sections";
import { OrganizationRequestHistory } from "@/components/new-organization-sections";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import {
  countPendingOrganizationsForAdministrator,
  getCurrentSession,
  isAdministrator,
  listOrganizationRequestsForSubject,
  listOrganizationsForSubject,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function OrganizationRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const isPlatformAdministrator = isAdministrator(current.subject);
  const [organizations, requests, query, pendingOrganizationRequestCount] = await Promise.all([
    listOrganizationsForSubject(current.subject.subjectId),
    listOrganizationRequestsForSubject(current.subject.subjectId),
    searchParams,
    isPlatformAdministrator
      ? countPendingOrganizationsForAdministrator(current.subject.subjectId).catch(() => null)
      : null,
  ]);
  const selected = organizations[0];
  const pendingRequest = requests.find((request) => request.status === "pending");
  const verified = Boolean(current.subject.emailVerifiedAt);
  const content = (
    <>
      <DashboardHeading
        description="Track existing requests or start a request for a new organization."
        action={
          verified && !pendingRequest ? (
            <Link className="button button-primary" href="/dashboard/new-organization/new">
              Request an organization
            </Link>
          ) : null
        }
      />
      <DashboardOnboardingNotices
        email={current.subject.primaryEmail}
        error={query.error}
        notice={query.notice}
      />
      <OrganizationSetupStep verified={verified} />
      <OrganizationRequestHistory requests={requests} />
      {!selected ? (
        <div className="onboarding-secondary">
          <span>Joining an existing team?</span>
          <Link href="/accept-invitation">Open an invitation</Link>
        </div>
      ) : null}
    </>
  );

  if (selected) {
    return (
      <DashboardShell
        organizationId={selected.organization.organizationId}
        organizationName={selected.organization.name}
        organizations={organizations}
        role={selected.membership.role}
        isPlatformAdministrator={isPlatformAdministrator}
        pendingOrganizationRequestCount={pendingOrganizationRequestCount}
        email={current.subject.primaryEmail}
        firstName={current.subject.firstName ?? null}
        lastName={current.subject.lastName ?? null}
      >
        {content}
      </DashboardShell>
    );
  }

  return (
    <>
      <SiteHeader active="dashboard" authenticated />
      <main className="page-shell onboarding-shell">
        <div className="container onboarding-page">
          <BreadcrumbBar items={[{ label: "Your organization requests" }]} />
          {content}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
