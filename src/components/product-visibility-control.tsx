"use client";

import { useModalDialog } from "@/components/use-modal-dialog";

export function ProductVisibilityControl({
  organizationId,
  productId,
  productRecordId,
  visibility,
  adopterOrganizations,
  initialDialogOpen = false,
}: {
  organizationId: string;
  productId: string;
  productRecordId: string;
  visibility: "private" | "public";
  adopterOrganizations: Array<{ organizationId: string; name: string }>;
  initialDialogOpen?: boolean;
}) {
  const isPublic = visibility === "public";
  const needsConfirmation = isPublic && adopterOrganizations.length > 0;
  const { dialogRef, openDialog, closeDialog } = useModalDialog(initialDialogOpen);

  return (
    <section className="product-visibility-control" aria-labelledby="product-visibility-title">
      <div>
        <h2 id="product-visibility-title">Product availability</h2>
        <p>
          {isPublic
            ? "Shared products can be added to other organizations. Product details and permission sets are shared."
            : "Private products are only available in this organization."}
        </p>
        {isPublic && adopterOrganizations.length ? (
          <small>
            Also used by {adopterOrganizations.length} other{" "}
            {adopterOrganizations.length === 1 ? "organization" : "organizations"}.
          </small>
        ) : null}
      </div>
      <form action="/actions/setOrganizationProductVisibilityAction" method="post">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="productRecordId" value={productRecordId} />
        <input type="hidden" name="visibility" value={isPublic ? "private" : "public"} />
        {needsConfirmation ? (
          <button className="button button-secondary" type="button" onClick={openDialog}>
            Make private
          </button>
        ) : (
          <button className="button button-secondary" type="submit">
            {isPublic ? "Make private" : "Share product"}
          </button>
        )}
      </form>

      <dialog
        className="product-privacy-dialog"
        ref={dialogRef}
        aria-labelledby="product-privacy-dialog-title"
        aria-describedby="product-privacy-dialog-description"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
      >
        <h2 id="product-privacy-dialog-title">Make this product private?</h2>
        <p id="product-privacy-dialog-description">
          The product will be removed from these organizations, and their members will lose access.
          Pending invitations, integrations, and API keys in those organizations will be revoked.
          The publisher&apos;s app clients remain configured for the product in its publisher
          organization.
        </p>
        <ul className="product-privacy-organization-list">
          {adopterOrganizations.map((organization) => (
            <li key={organization.organizationId}>{organization.name}</li>
          ))}
        </ul>
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" type="button" onClick={closeDialog}>
            Cancel
          </button>
          <form action="/actions/setOrganizationProductVisibilityAction" method="post">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="productRecordId" value={productRecordId} />
            <input type="hidden" name="visibility" value="private" />
            <input type="hidden" name="confirmedPrivateRemoval" value="true" />
            <button className="button button-danger" type="submit">
              Make private and remove access
            </button>
          </form>
        </div>
      </dialog>
    </section>
  );
}
