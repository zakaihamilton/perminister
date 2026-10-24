import { CustomDropdown } from "@/components/custom-dropdown";
import { DashboardNotice } from "@/components/dashboard-shell";
import { ProductPeopleMemberList } from "@/components/people-member-lists";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
import type { ProductMemberView } from "@/lib/auth/service";

const productPeopleErrorText: Record<string, string> = {
  "mail-unconfigured": "Invitations are unavailable until email delivery is set up.",
  "invite-failed": "The invitation could not be sent. Check the email address and your role.",
  "member-update": "Only the product owner can change roles, and the product must keep an owner.",
  "member-remove": "The member could not be removed. The product must keep an owner.",
  "invite-revoke": "The invitation could not be canceled.",
};

export function ProductPeopleNotices({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {notice === "invite-sent" ? (
        <DashboardNotice message="Invitation sent by email." kind="success" />
      ) : null}
      {notice === "invite-revoked" ? (
        <DashboardNotice message="Invitation canceled." kind="success" />
      ) : null}
      {notice === "member-updated" ? (
        <DashboardNotice message="Member role updated." kind="success" />
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
    <ProductPeopleMemberList
      isOwner={isOwner}
      members={members}
      organizationId={organizationId}
      productId={productId}
    />
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
      <DashboardNotice message="Invitations are unavailable until email delivery is set up." />
    );
  }

  return (
    <section className="dashboard-card invite-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Invite a product member</h2>
          <p>Invitations apply to this product only and expire after seven days.</p>
        </div>
      </div>
      <form
        action="/actions/inviteProductMemberAction"
        method="post"
        className="auth-form invite-form"
      >
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
