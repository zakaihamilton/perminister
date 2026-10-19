import Link from "next/link";
import { PendingInvitations } from "@/components/pending-invitations";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  OrganizationPeopleNotices,
  OrganizationPeopleSection,
} from "@/components/organization-people-sections";
import {
  getOrganizationForSubject,
  listOrganizationInvitations,
  listOrganizationMembers,
} from "@/lib/auth/service";
import {
  getOrganizationDashboardRequestContext,
  type OrganizationDashboardPageProps,
} from "@/lib/auth/organization-dashboard-context";
import { redirect } from "next/navigation";

export default async function PeoplePage(
  props: OrganizationDashboardPageProps<{ notice?: string; error?: string }>,
) {
  const { current, organizationId, query } = await getOrganizationDashboardRequestContext(props);
  const organization = await getOrganizationForSubject(current.subject.subjectId, organizationId);
  if (organization.membership.role === "member") redirect(`/dashboard/${organizationId}/products`);
  const [members, invitations] = await Promise.all([
    listOrganizationMembers(current.subject.subjectId, organizationId),
    listOrganizationInvitations(current.subject.subjectId, organizationId),
  ]);
  const owner = organization.membership.role === "owner";
  return (
    <>
      <DashboardHeading
        description="Organization owners and admins manage members and invitations. Each product has its own members and permissions."
        action={
          owner ? (
            <Link
              className="button button-primary"
              href={`/dashboard/${organizationId}/people/invite`}
            >
              Invite member
            </Link>
          ) : null
        }
      />
      <OrganizationPeopleNotices error={query.error} notice={query.notice} />
      <OrganizationPeopleSection
        currentSubjectId={current.subject.subjectId}
        members={members}
        organizationId={organizationId}
        owner={owner}
      />

      <PendingInvitations
        allowOrganizationResend={owner}
        invitations={invitations}
        organizationId={organizationId}
      />
      <p className="role-help">
        Product owner and admin roles, invitations, and permissions are managed on that
        product&apos;s Members and Permissions pages.
      </p>
    </>
  );
}
