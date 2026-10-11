import { revokeOrganizationInvitationAction } from "@/app/actions";
import { PendingInvitations } from "@/components/pending-invitations";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  InviteCatalogManagerSection,
  OrganizationPeopleNotices,
  OrganizationPeopleSection,
} from "@/components/organization-people-sections";
import {
  getOrganizationForSubject,
  listOrganizationInvitations,
  listOrganizationMembers,
} from "@/lib/auth/service";
import { getOrganizationDashboardRequestContext } from "@/lib/auth/organization-dashboard-context";
import { redirect } from "next/navigation";

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { current, organizationId, query } = await getOrganizationDashboardRequestContext(
    params,
    searchParams,
  );
  const organization = await getOrganizationForSubject(current.subject.subjectId, organizationId);
  if (organization.membership.role === "member") redirect(`/dashboard/${organizationId}/products`);
  const [members, invitations] = await Promise.all([
    listOrganizationMembers(current.subject.subjectId, organizationId),
    listOrganizationInvitations(current.subject.subjectId, organizationId),
  ]);
  const owner = organization.membership.role === "owner";
  return (
    <>
      <DashboardHeading description="Catalog managers maintain organization and product details. Product roles and permissions are managed inside each product." />
      <OrganizationPeopleNotices error={query.error} notice={query.notice} />
      <OrganizationPeopleSection
        currentSubjectId={current.subject.subjectId}
        members={members}
        organizationId={organizationId}
        owner={owner}
      />

      {owner ? <InviteCatalogManagerSection organizationId={organizationId} /> : null}

      <PendingInvitations
        invitations={invitations}
        organizationId={organizationId}
        formAction={revokeOrganizationInvitationAction}
      />
      <p className="role-help">
        Product Owner and Admin roles, invitations, and permission grants are managed in that
        product’s People and Access pages.
      </p>
    </>
  );
}
