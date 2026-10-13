import type { OrganizationInvitationRecord } from "@/lib/auth/domain";

type Invitation = Pick<
  OrganizationInvitationRecord,
  "invitationId" | "email" | "role" | "expiresAt"
>;
export function PendingInvitations({
  invitations,
  organizationId,
  productId,
}: {
  invitations: readonly Invitation[];
  organizationId: string;
  productId?: string;
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
          {productId ? (
            <form action="/actions/revokeProductInvitationAction" method="post">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="invitationId" value={invitation.invitationId} />
              <button className="button button-secondary" type="submit">
                Cancel invitation
              </button>
            </form>
          ) : (
            <form action="/actions/revokeOrganizationInvitationAction" method="post">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="invitationId" value={invitation.invitationId} />
              <button className="button button-secondary" type="submit">
                Cancel invitation
              </button>
            </form>
          )}
        </div>
      ))}
    </section>
  );
}
