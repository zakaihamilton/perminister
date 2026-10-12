import { revokeOrganizationInvitationAction } from "@/app/actions";
import { PendingInvitations } from "@/components/pending-invitations";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  InviteOrganizationMemberSection,
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
      <DashboardHeading description="Organization owners and admins manage members and invitations. Each product has its own members and permissions." />
      <OrganizationPeopleNotices error={query.error} notice={query.notice} />
      <OrganizationPeopleSection
        currentSubjectId={current.subject.subjectId}
        members={members}
        organizationId={organizationId}
        owner={owner}
      />

      {owner ? <InviteOrganizationMemberSection organizationId={organizationId} /> : null}

      <PendingInvitations
        invitations={invitations}
        organizationId={organizationId}
        formAction={revokeOrganizationInvitationAction}
      />
      <p className="role-help">
        Product owner and admin roles, invitations, and permissions are managed on that
        product&apos;s Members and Permissions pages.
      </p>
    </>
  );
}
