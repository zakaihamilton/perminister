import { CustomDropdown } from "@/components/custom-dropdown";
import { DashboardNotice } from "@/components/dashboard-shell";
import { ProductPeopleMemberList } from "@/components/people-member-lists";
import type { ProductAccessRole } from "@/lib/auth/access-roles";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
import type { ProductMemberView } from "@/lib/auth/service";

const productPeopleErrorText: Record<string, string> = {
  "mail-unconfigured": "Invitations are unavailable until email delivery is set up.",
  "invite-failed": "The invitation could not be sent. Check the email address and your role.",
  "member-update": "Only the product owner can change roles, and the product must keep an owner.",
  "member-remove": "The member could not be removed. The product must keep an owner.",
  "invite-revoke": "The invitation could not be canceled.",
  "existing-member-failed":
    "Could not add or update this account. Choose an existing, active, verified Perminister account and an available product role. Only the product owner can change Member or Admin status. No invitation was sent.",
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
      {notice === "existing-member-added" ? (
        <DashboardNotice message="Existing account added with the selected product role. No email was sent." kind="success" />
      ) : null}
      {notice === "existing-member-updated" ? (
        <DashboardNotice message="Existing account's product access was updated. No email was sent." kind="success" />
      ) : null}
      {notice === "existing-member-already-assigned" ? (
        <DashboardNotice message="This account already has the selected product role." kind="success" />
      ) : null}
      {error && productPeopleErrorText[error] ? (
        <DashboardNotice message={productPeopleErrorText[error]} kind="error" />
      ) : null}
    </>
  );
}

export function AddExistingProductMemberSection({
  accessRoles,
  organizationId,
  productId,
  isProductOwner,
}: {
  accessRoles: ProductAccessRole[];
  organizationId: string;
  productId: string;
  isProductOwner: boolean;
}) {
  const peoplePath = `/dashboard/${encodeURIComponent(
    organizationId,
  )}/products/${encodeURIComponent(productId)}/people`;
  const addMemberAction = `/actions/addExistingProductMemberAction?returnTo=${encodeURIComponent(
    peoplePath,
  )}`;
  const assignableRoles = accessRoles.filter(
    (role) => !role.deprecated && (!role.scopeKinds || role.scopeKinds.includes("product")),
  );

  return (
    <section className="dashboard-card invite-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Add an existing account</h2>
          <p>
            Add an active, verified Perminister account to this product and choose one of its
            available roles. This activates access immediately and sends no email.
          </p>
        </div>
      </div>
      {assignableRoles.length > 0 ? (
        <form
          action={addMemberAction}
          method="post"
          className="auth-form invite-form product-member-add-form"
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
          <label htmlFor="existing-product-member-role">
            Product access role
            <CustomDropdown
              aria-label="Product access role"
              id="existing-product-member-role"
              name="accessRoleId"
              defaultValue=""
              options={assignableRoles.map((role) => ({
                value: role.id,
                label: role.name,
              }))}
              placeholder="Choose a product role"
              required
            />
          </label>
          <label htmlFor="existing-product-member-membership-role">
            Perminister product access
            <CustomDropdown
              aria-label="Perminister product access"
              id="existing-product-member-membership-role"
              name="membershipRole"
              defaultValue="member"
              options={[
                { value: "member", label: "Member" },
                ...(isProductOwner ? [{ value: "admin", label: "Admin" }] : []),
              ]}
              required
            />
          </label>
          <p className="role-help">
            Admin can manage this product in Perminister. The product access role above controls
            permissions inside the product.
          </p>
          <button className="button button-primary" type="submit">
            Add account
          </button>
        </form>
      ) : (
        <p className="role-help">
          Add a product-level role in Permission sets before adding an account. No invitation will
          be sent.
        </p>
      )}
    </section>
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
