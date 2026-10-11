import {
  inviteProductMemberAction,
  removeProductMemberAction,
  updateProductMemberRoleAction,
} from "@/app/actions";
import { CustomDropdown } from "@/components/custom-dropdown";
import { DashboardNotice } from "@/components/dashboard-shell";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
import type { ProductMemberView } from "@/lib/auth/service";

const productPeopleErrorText: Record<string, string> = {
  "mail-unconfigured": "Invitation email is unavailable until Resend is configured.",
  "invite-failed":
    "The invitation could not be sent. Check the email address and your product role.",
  "member-update": "Only a Product Owner can change roles, and the product must keep an Owner.",
  "member-remove": "The member could not be removed. The product must keep an Owner.",
  "invite-revoke": "The invitation could not be revoked.",
};

export function ProductPeopleNotices({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {notice === "invite-sent" ? (
        <DashboardNotice message="Product invitation sent." kind="success" />
      ) : null}
      {notice === "invite-revoked" ? (
        <DashboardNotice message="Invitation revoked." kind="success" />
      ) : null}
      {notice === "member-updated" ? (
        <DashboardNotice message="Product role updated." kind="success" />
      ) : null}
      {notice === "member-removed" ? (
        <DashboardNotice message="Member removed from this product." kind="success" />
      ) : null}
      {error && productPeopleErrorText[error] ? (
        <DashboardNotice message={productPeopleErrorText[error]} kind="error" />
      ) : null}
    </>
  );
}

function ProductMemberRow({
  isOwner,
  member,
  organizationId,
  productId,
}: {
  isOwner: boolean;
  member: ProductMemberView;
  organizationId: string;
  productId: string;
}) {
  const { membership, email, emailVerified } = member;

  return (
    <article className="people-row">
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
            <label className="visually-hidden" htmlFor={`product-role-${membership.subjectId}`}>
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
  );
}

export function ProductPeopleSection({
  isOwner,
  members,
  organizationId,
  productId,
}: {
  isOwner: boolean;
  members: ProductMemberView[];
  organizationId: string;
  productId: string;
}) {
  return (
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
        {members.map((member) => (
          <ProductMemberRow
            key={member.membership.organizationMembershipId}
            isOwner={isOwner}
            member={member}
            organizationId={organizationId}
            productId={productId}
          />
        ))}
      </div>
    </section>
  );
}

export function InviteProductMemberSection({
  isOwner,
  organizationId,
  productId,
}: {
  isOwner: boolean;
  organizationId: string;
  productId: string;
}) {
  if (!isMailDeliveryConfigured()) {
    return (
      <DashboardNotice message="Invitation email is unavailable until the Perminister operator configures Resend." />
    );
  }

  return (
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
  );
}
