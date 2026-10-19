import type { OrganizationInvitationRecord } from "@/lib/auth/domain";
import { ConfirmationActionControl } from "@/components/confirmation-action-control";

type Invitation = Pick<
  OrganizationInvitationRecord,
  "invitationId" | "email" | "role" | "expiresAt"
>;
export function PendingInvitations({
  invitations,
  organizationId,
  productId,
  allowOrganizationResend = false,
}: {
  invitations: readonly Invitation[];
  organizationId: string;
  productId?: string;
  allowOrganizationResend?: boolean;
}) {
  if (invitations.length === 0) return null;

  return (
    <section className="dashboard-card pending-invitations">
      <div className="dashboard-card-heading">
        <div>
          <h2>Pending invitations</h2>
          <p>Invitations expire after seven days.</p>
        </div>
      </div>
      {invitations.map((invitation) => (
        <div className="pending-invite-row" key={invitation.invitationId}>
          <span>
            <strong>{invitation.email}</strong>
            <small>
              {invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
            </small>
          </span>
          {allowOrganizationResend && !productId ? (
            <form action="/actions/resendOrganizationInvitationAction" method="post">
              <input name="organizationId" type="hidden" value={organizationId} />
              <input name="invitationId" type="hidden" value={invitation.invitationId} />
              <button className="button button-secondary" type="submit">
                Resend
              </button>
            </form>
          ) : null}
          <ConfirmationActionControl
            action={
              productId
                ? "/actions/revokeProductInvitationAction"
                : "/actions/revokeOrganizationInvitationAction"
            }
            fields={[
              { name: "organizationId", value: organizationId },
              ...(productId ? [{ name: "productId", value: productId }] : []),
              { name: "invitationId", value: invitation.invitationId },
            ]}
            triggerLabel="Cancel invitation"
            title={`Cancel the invitation for ${invitation.email}?`}
            description="The invitation link will stop working. Send a new invitation if they still need access."
            confirmLabel="Cancel invitation"
          />
        </div>
      ))}
    </section>
  );
}
