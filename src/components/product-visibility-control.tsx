"use client";

import { useEffect, useRef, useState } from "react";
import { setOrganizationProductVisibilityAction } from "@/app/actions";

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
  const [dialogOpen, setDialogOpen] = useState(initialDialogOpen);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

  return (
    <section className="product-visibility-control" aria-labelledby="product-visibility-title">
      <div>
        <h2 id="product-visibility-title">Product availability</h2>
        <p>
          {isPublic
            ? "Public products can be added to other organizations. Updates to product details and access roles are shared."
            : "Private products are only available in this organization."}
        </p>
        {isPublic && adopterOrganizations.length ? (
          <small>
            Also used by {adopterOrganizations.length} other{" "}
            {adopterOrganizations.length === 1 ? "organization" : "organizations"}.
          </small>
        ) : null}
      </div>
      <form action={setOrganizationProductVisibilityAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="productRecordId" value={productRecordId} />
        <input type="hidden" name="visibility" value={isPublic ? "private" : "public"} />
        {needsConfirmation ? (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setDialogOpen(true)}
          >
            Make private
          </button>
        ) : (
          <button className="button button-secondary" type="submit">
            Make {isPublic ? "private" : "public"}
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
          setDialogOpen(false);
        }}
      >
        <h2 id="product-privacy-dialog-title">Make this product private?</h2>
        <p id="product-privacy-dialog-description">
          It will be removed from these organizations. Their product memberships, access grants,
          invitations, app clients, integrations, and API keys will be revoked.
        </p>
        <ul className="product-privacy-organization-list">
          {adopterOrganizations.map((organization) => (
            <li key={organization.organizationId}>{organization.name}</li>
          ))}
        </ul>
        <div className="product-privacy-dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setDialogOpen(false)}
          >
            Cancel
          </button>
          <form action={setOrganizationProductVisibilityAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="productRecordId" value={productRecordId} />
            <input type="hidden" name="visibility" value="private" />
            <input type="hidden" name="confirmedPrivateRemoval" value="true" />
            <button className="button button-danger" type="submit">
              Make private and revoke access
            </button>
          </form>
        </div>
      </dialog>
    </section>
  );
}
