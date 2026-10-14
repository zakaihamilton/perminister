import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import { InviteOrganizationMemberSection } from "@/components/organization-people-sections";
import { getOrganizationForSubject, getCurrentSession } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function InviteOrganizationMemberPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const { organizationId } = await params;
  const organization = await getOrganizationForSubject(current.subject.subjectId, organizationId);
  const peoplePath = `/dashboard/${organizationId}/people`;
  if (organization.membership.role !== "owner") redirect(peoplePath);

  return (
    <>
      <DashboardHeading
        description="Send an invitation for someone to join this organization."
        action={
          <Link className="button button-secondary" href={peoplePath}>
            Back to members
          </Link>
        }
      />
      <InviteOrganizationMemberSection organizationId={organizationId} />
    </>
  );
}
