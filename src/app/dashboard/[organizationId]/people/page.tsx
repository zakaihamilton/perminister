import {
  inviteOrganizationMemberAction,
  removeOrganizationMemberAction,
  revokeOrganizationInvitationAction,
  updateOrganizationMemberRoleAction,
} from "@/app/actions";
import { CustomDropdown } from "@/components/custom-dropdown";
import { PendingInvitations } from "@/components/pending-invitations";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  getOrganizationForSubject,
  listOrganizationInvitations,
  listOrganizationMembers,
} from "@/lib/auth/service";
import { getOrganizationDashboardRequestContext } from "@/lib/auth/organization-dashboard-context";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
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
  const errorText: Record<string, string> = {
    "mail-unconfigured": "Invitation email is unavailable until Resend is configured.",
    "invite-failed": "The invitation could not be sent. Check the email address and try again.",
    "member-update": "Only an owner can change roles, and the organization must keep an owner.",
    "member-remove": "The member could not be removed. The organization must keep an owner.",
    "invite-revoke": "The invitation could not be revoked.",
  };

  return (
    <>
      <DashboardHeading description="Catalog managers maintain organization and product details. Product roles and permissions are managed inside each product." />
      {query.notice === "invite-sent" ? (
        <DashboardNotice message="Invitation email sent." kind="success" />
      ) : null}
      {query.notice === "member-updated" ? (
        <DashboardNotice message="Member role updated." kind="success" />
      ) : null}
      {query.notice === "member-removed" ? (
        <DashboardNotice message="Member removed from the organization." kind="success" />
      ) : null}
      {query.notice === "invite-revoked" ? (
        <DashboardNotice message="Invitation revoked." kind="success" />
      ) : null}
      {query.error && errorText[query.error] ? (
        <DashboardNotice message={errorText[query.error]} kind="error" />
      ) : null}

      <section className="dashboard-card people-card">
        <div className="dashboard-card-heading">
          <div>
            <h2>Organization catalog managers</h2>
            <p>
              {members.length} active {members.length === 1 ? "manager" : "managers"}
            </p>
          </div>
        </div>
        <div className="people-list">
          {members.map((member) => (
            <article className="people-row" key={member.membership.organizationMembershipId}>
              <div className="people-avatar" aria-hidden="true">
                {(member.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="people-identity">
                <strong>{member.email ?? "Account unavailable"}</strong>
                <small>{member.emailVerified ? "Verified email" : "Email not verified"}</small>
              </div>
              <span className={`role-pill role-${member.membership.role}`}>
                {member.membership.role}
              </span>
              {owner ? (
                <div className="people-row-actions">
                  <form action={updateOrganizationMemberRoleAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input
                      type="hidden"
                      name="membershipId"
                      value={member.membership.organizationMembershipId}
                    />
                    <label
                      className="visually-hidden"
                      htmlFor={`role-${member.membership.organizationMembershipId}`}
                    >
                      Role for {member.email}
                    </label>
                    <CustomDropdown
                      aria-label={`Role for ${member.email}`}
                      id={`role-${member.membership.organizationMembershipId}`}
                      name="role"
                      defaultValue={member.membership.role}
                      className="people-role-dropdown"
                      options={[
                        { value: "owner", label: "Owner" },
                        { value: "admin", label: "Admin" },
                      ]}
                    />
                    <button className="button button-secondary" type="submit">
                      Save role
                    </button>
                  </form>
                  {member.membership.subjectId !== current.subject.subjectId ? (
                    <form action={removeOrganizationMemberAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input
                        type="hidden"
                        name="membershipId"
                        value={member.membership.organizationMembershipId}
                      />
                      <button className="button button-secondary" type="submit">
                        Remove
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {owner ? (
        <section className="dashboard-card invite-card">
          <div className="dashboard-card-heading">
            <div>
              <h2>Invite a catalog manager</h2>
              <p>They’ll receive a secure invitation link by email.</p>
            </div>
          </div>
          {isMailDeliveryConfigured() ? (
            <form action={inviteOrganizationMemberAction} className="auth-form invite-form">
              <input type="hidden" name="organizationId" value={organizationId} />
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="teammate@example.com"
                />
              </label>
              <label htmlFor="invite-role">
                Role
                <CustomDropdown
                  aria-label="Role"
                  id="invite-role"
                  name="role"
                  defaultValue="admin"
                  options={[{ value: "admin", label: "Admin" }]}
                />
              </label>
              <button className="button button-primary" type="submit">
                Send invitation
              </button>
            </form>
          ) : (
            <p className="dashboard-notice info">
              Invitation email is unavailable until the Perminister operator configures Resend.
            </p>
          )}
        </section>
      ) : null}

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
