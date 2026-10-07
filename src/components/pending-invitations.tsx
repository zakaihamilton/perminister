import type { FormHTMLAttributes } from "react";
import type { OrganizationInvitationRecord } from "@/lib/auth/domain";

type Invitation = Pick<
  OrganizationInvitationRecord,
  "invitationId" | "email" | "role" | "expiresAt"
>;
type FormAction = NonNullable<FormHTMLAttributes<HTMLFormElement>["action"]>;

export function PendingInvitations({
  invitations,
  organizationId,
  productId,
  formAction,
}: {
  invitations: readonly Invitation[];
  organizationId: string;
  productId?: string;
  formAction: FormAction;
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
          <form action={formAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            {productId ? <input type="hidden" name="productId" value={productId} /> : null}
            <input type="hidden" name="invitationId" value={invitation.invitationId} />
            <button className="button button-secondary" type="submit">
              Revoke invitation
            </button>
          </form>
        </div>
      ))}
    </section>
  );
}
