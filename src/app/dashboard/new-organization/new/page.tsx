import Link from "next/link";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import { DashboardHeading, DashboardShell } from "@/components/dashboard-shell";
import {
  NewOrganizationRequestNotices,
  OrganizationRequestSubmission,
} from "@/components/new-organization-sections";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import {
  countPendingOrganizationsForAdministrator,
  getCurrentSession,
  isAdministrator,
  listOrganizationRequestsForSubject,
  listOrganizationsForSubject,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function NewOrganizationRequestPage({
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
  const content = (
    <>
      <DashboardHeading
        description="A platform administrator must approve each organization before you can use it."
        action={
          <Link className="button button-secondary" href="/dashboard/new-organization">
            Back to requests
          </Link>
        }
      />
      <NewOrganizationRequestNotices error={query.error} notice={query.notice} />
      <OrganizationRequestSubmission
        emailVerified={Boolean(current.subject.emailVerifiedAt)}
        hasPendingRequest={requests.some((request) => request.status === "pending")}
      />
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
          <BreadcrumbBar
            items={[
              { label: "Your organization requests", href: "/dashboard/new-organization" },
              { label: "Request an organization" },
            ]}
          />
          {content}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
