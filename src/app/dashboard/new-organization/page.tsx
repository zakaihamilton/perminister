import Link from "next/link";
import { DashboardHeading, DashboardShell } from "@/components/dashboard-shell";
import {
  NewOrganizationRequestNotices,
  OrganizationRequestHistory,
  OrganizationRequestSubmission,
} from "@/components/new-organization-sections";
import {
  countPendingOrganizationsForAdministrator,
  getCurrentSession,
  isAdministrator,
  listOrganizationRequestsForSubject,
  listOrganizationsForSubject,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function NewOrganizationPage({
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
  if (!organizations.length) redirect("/dashboard");
  const selected = organizations[0];

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
      <DashboardHeading
        description="A platform administrator must approve each new organization before you can use it."
        action={
          <Link
            className="button button-secondary"
            href={`/dashboard/${selected.organization.organizationId}`}
          >
            Cancel
          </Link>
        }
      />
      <NewOrganizationRequestNotices error={query.error} notice={query.notice} />
      <OrganizationRequestHistory requests={requests} />
      <OrganizationRequestSubmission
        emailVerified={Boolean(current.subject.emailVerifiedAt)}
        hasPendingRequest={requests.some((request) => request.status === "pending")}
      />
    </DashboardShell>
  );
}
