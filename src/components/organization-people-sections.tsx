import { CustomDropdown } from "@/components/custom-dropdown";
import { DashboardNotice } from "@/components/dashboard-shell";
import { OrganizationPeopleMemberList } from "@/components/people-member-lists";
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
    <OrganizationPeopleMemberList
      currentSubjectId={currentSubjectId}
      members={members}
      organizationId={organizationId}
      owner={owner}
    />
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
