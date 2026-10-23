import { CustomDropdown } from "@/components/custom-dropdown";
import { ConfirmationActionControl } from "@/components/confirmation-action-control";
import { DashboardNotice } from "@/components/dashboard-shell";
import { ClientFilteredList } from "@/components/client-filtered-list";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
import type { OrganizationMemberView } from "@/lib/auth/service";

const peopleErrorText: Record<string, string> = {
  "mail-unconfigured": "Invitations are unavailable until email delivery is set up.",
  "invite-failed": "The invitation could not be sent. Check the email address and try again.",
  "resend-failed": "The invitation could not be resent. Reload the page and try again.",
  "member-update": "Only an owner can change roles, and the organization must keep an owner.",
  "member-remove": "The member could not be removed. The organization must keep an owner.",
  "invite-revoke": "The invitation could not be revoked.",
};

export function OrganizationPeopleNotices({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {notice === "invite-sent" ? (
        <DashboardNotice message="Invitation sent by email." kind="success" />
      ) : null}
      {notice === "invite-resent" ? (
        <DashboardNotice message="Invitation resent by email." kind="success" />
      ) : null}
      {notice === "member-updated" ? (
        <DashboardNotice message="Member role updated." kind="success" />
      ) : null}
      {notice === "member-removed" ? (
        <DashboardNotice message="Member removed from the organization." kind="success" />
      ) : null}
      {notice === "invite-revoked" ? (
        <DashboardNotice message="Invitation canceled." kind="success" />
      ) : null}
      {error && peopleErrorText[error] ? (
        <DashboardNotice message={peopleErrorText[error]} kind="error" />
      ) : null}
    </>
  );
}

function OrganizationMemberRow({
  currentSubjectId,
  member,
  organizationId,
  owner,
}: {
  currentSubjectId: string;
  member: OrganizationMemberView;
  organizationId: string;
  owner: boolean;
}) {
  const membershipId = member.membership.organizationMembershipId;

  return (
    <article className="people-row">
      <div className="people-avatar" aria-hidden="true">
        {(member.email ?? "?").slice(0, 1).toUpperCase()}
      </div>
      <div className="people-identity">
        <strong>{member.email ?? "Account unavailable"}</strong>
        <small>{member.emailVerified ? "Verified email" : "Email not verified"}</small>
      </div>
      <span className={`role-pill role-${member.membership.role}`}>
        {member.membership.role.charAt(0).toUpperCase() + member.membership.role.slice(1)}
      </span>
      {owner ? (
        <div className="people-row-actions">
          <form action="/actions/updateOrganizationMemberRoleAction" method="post">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="membershipId" value={membershipId} />
            <label className="visually-hidden" htmlFor={`role-${membershipId}`}>
              Role for {member.email}
            </label>
            <CustomDropdown
              aria-label={`Role for ${member.email}`}
              id={`role-${membershipId}`}
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
          {member.membership.subjectId !== currentSubjectId ? (
            <ConfirmationActionControl
              action="/actions/removeOrganizationMemberAction"
              fields={[
                { name: "organizationId", value: organizationId },
                { name: "membershipId", value: membershipId },
              ]}
              triggerLabel="Remove member"
              title={`Remove ${member.email ?? "this member"} from the organization?`}
              description="They will lose their organization membership and access through it. You can invite them again later."
              confirmLabel="Remove member"
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function OrganizationPeopleSection({
  currentSubjectId,
  members,
  organizationId,
  owner,
}: {
  currentSubjectId: string;
  members: OrganizationMemberView[];
  organizationId: string;
  owner: boolean;
}) {
  return (
    <section className="dashboard-card people-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Organization members</h2>
          <p>
            {members.length} active {members.length === 1 ? "member" : "members"}
          </p>
        </div>
      </div>
      <div className="people-list">
        <ClientFilteredList
          items={members}
          placeholder="Filter members by name or email..."
          ariaLabel="Filter organization members"
          emptyMessage="No members match your filter."
          filterFn={(member, q) => {
            const email = member.email?.toLowerCase() ?? "";
            const role = member.membership.role.toLowerCase();
            return email.includes(q) || role.includes(q);
          }}
          renderItem={(member) => (
            <OrganizationMemberRow
              key={member.membership.organizationMembershipId}
              currentSubjectId={currentSubjectId}
              member={member}
              organizationId={organizationId}
              owner={owner}
            />
          )}
        />
      </div>
    </section>
  );
}

export function InviteOrganizationMemberSection({ organizationId }: { organizationId: string }) {
  return (
    <section className="dashboard-card invite-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Invite an organization member</h2>
          <p>They’ll receive a secure invitation link by email.</p>
        </div>
      </div>
      {isMailDeliveryConfigured() ? (
        <form
          action="/actions/inviteOrganizationMemberAction"
          method="post"
          className="auth-form invite-form"
        >
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
          Invitations are unavailable until email delivery is set up. Contact the Perminister
          administrator for help.
        </p>
      )}
    </section>
  );
}
