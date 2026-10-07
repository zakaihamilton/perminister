import {
  inviteProductMemberAction,
  removeProductMemberAction,
  revokeProductInvitationAction,
  updateProductMemberRoleAction,
} from "@/app/actions";
import { CustomDropdown } from "@/components/custom-dropdown";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
import {
  getProductAccessForSubject,
  getCurrentSession,
  listProductInvitations,
  listProductMembers,
} from "@/lib/auth/service";
import { notFound, redirect } from "next/navigation";

export default async function ProductPeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; productId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId, productId }, query] = await Promise.all([params, searchParams]);
  const access = await getProductAccessForSubject(
    current.subject.subjectId,
    organizationId,
    productId,
  ).catch(() => null);
  if (!access) notFound();
  const role = access.membership?.role;
  if (role !== "owner" && role !== "admin")
    redirect(`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}`);

  const [members, invitations] = await Promise.all([
    listProductMembers(current.subject.subjectId, organizationId, productId),
    listProductInvitations(current.subject.subjectId, organizationId, productId),
  ]);
  const isOwner = role === "owner";
  const errorMessages: Record<string, string> = {
    "mail-unconfigured": "Invitation email is unavailable until Resend is configured.",
    "invite-failed":
      "The invitation could not be sent. Check the email address and your product role.",
    "member-update": "Only a Product Owner can change roles, and the product must keep an Owner.",
    "member-remove": "The member could not be removed. The product must keep an Owner.",
    "invite-revoke": "The invitation could not be revoked.",
  };

  return (
    <>
      <DashboardHeading
        eyebrow={access.product.name}
        title="People"
        description="Manage this product’s members and their product roles."
      />
      {query.notice === "invite-sent" ? (
        <DashboardNotice message="Product invitation sent." kind="success" />
      ) : null}
      {query.notice === "invite-revoked" ? (
        <DashboardNotice message="Invitation revoked." kind="success" />
      ) : null}
      {query.notice === "member-updated" ? (
        <DashboardNotice message="Product role updated." kind="success" />
      ) : null}
      {query.notice === "member-removed" ? (
        <DashboardNotice message="Member removed from this product." kind="success" />
      ) : null}
      {query.error && errorMessages[query.error] ? (
        <DashboardNotice message={errorMessages[query.error]} kind="error" />
      ) : null}

      <section className="dashboard-card people-card">
        <div className="dashboard-card-heading">
          <div>
            <h2>Product members</h2>
            <p>
              {members.length} active {members.length === 1 ? "member" : "members"}
            </p>
          </div>
        </div>
        <div className="people-list">
          {members.map(({ membership, email, emailVerified }) => (
            <article className="people-row" key={membership.organizationMembershipId}>
              <div className="people-avatar" aria-hidden="true">
                {(email ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="people-identity">
                <strong>{email ?? "Account unavailable"}</strong>
                <small>{emailVerified ? "Verified email" : "Email not verified"}</small>
              </div>
              <span className={`role-pill role-${membership.role}`}>{membership.role}</span>
              {isOwner ? (
                <div className="people-row-actions">
                  <form action={updateProductMemberRoleAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="productId" value={productId} />
                    <input type="hidden" name="subjectId" value={membership.subjectId} />
                    <label
                      className="visually-hidden"
                      htmlFor={`product-role-${membership.subjectId}`}
                    >
                      Product role for {email}
                    </label>
                    <CustomDropdown
                      aria-label={`Product role for ${email}`}
                      id={`product-role-${membership.subjectId}`}
                      name="role"
                      defaultValue={membership.role}
                      className="people-role-dropdown"
                      options={[
                        { value: "owner", label: "Owner" },
                        { value: "admin", label: "Admin" },
                        { value: "member", label: "Member" },
                      ]}
                    />
                    <button className="button button-secondary" type="submit">
                      Save role
                    </button>
                  </form>
                  <form action={removeProductMemberAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="productId" value={productId} />
                    <input type="hidden" name="subjectId" value={membership.subjectId} />
                    <button className="button button-secondary" type="submit">
                      Remove
                    </button>
                  </form>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {isMailDeliveryConfigured() ? (
        <section className="dashboard-card invite-card">
          <div className="dashboard-card-heading">
            <div>
              <h2>Invite someone to this product</h2>
              <p>Invitations apply to this product only and expire after seven days.</p>
            </div>
          </div>
          <form action={inviteProductMemberAction} className="auth-form invite-form">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="productId" value={productId} />
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
            <label htmlFor="product-invite-role">
              Product role
              <CustomDropdown
                aria-label="Product role"
                id="product-invite-role"
                name="role"
                defaultValue="member"
                options={[
                  { value: "member", label: "Member" },
                  ...(isOwner ? [{ value: "admin", label: "Admin" }] : []),
                ]}
              />
            </label>
            <button className="button button-primary" type="submit">
              Send invitation
            </button>
          </form>
        </section>
      ) : (
        <DashboardNotice message="Invitation email is unavailable until the Perminister operator configures Resend." />
      )}

      {invitations.length ? (
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
              <form action={revokeProductInvitationAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="productId" value={productId} />
                <input type="hidden" name="invitationId" value={invitation.invitationId} />
                <button className="button button-secondary" type="submit">
                  Revoke invitation
                </button>
              </form>
            </div>
          ))}
        </section>
      ) : null}
      <p className="role-help">
        Product Owners change roles or remove members. Product Owners and Admins can invite Members
        and manage access grants. A member’s role does not grant API actions.
      </p>
    </>
  );
}
