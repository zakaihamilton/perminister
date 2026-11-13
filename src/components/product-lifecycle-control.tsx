"use client";

import { useId } from "react";
import { AlertDialog } from "panel-frame-ui";
import type { ProductRecord } from "@/lib/auth/domain";
import { useModalDialog } from "@/components/use-modal-dialog";

export function ProductLifecycleControl({
  adopterOrganizations,
  organizationId,
  product,
}: {
  adopterOrganizations: Array<{ organizationId: string; name: string }>;
  organizationId: string;
  product: ProductRecord;
}) {
  const { isOpen, openDialog, closeDialog } = useModalDialog();
  const dialogId = useId();
  const isSharedInstallation = Boolean(product.sharedProductRef);
  const deletionInProgress = Boolean(product.deletionStartedAt && !product.deletedAt);
  const isArchived = Boolean(product.archivedAt || deletionInProgress);

  if (product.deletedAt) return null;

  return (
    <section className="product-lifecycle-control" aria-labelledby={`${dialogId}-heading`}>
      <div className="product-lifecycle-copy">
        <h2 id={`${dialogId}-heading`}>{isArchived ? "Archived product" : "Product lifecycle"}</h2>
        <p>
          {deletionInProgress
            ? "Deletion is in progress. Retry to finish revoking access and removing shared installations."
            : isArchived
              ? "Existing access and app clients remain active. Restore this product to manage it again."
              : isSharedInstallation
                ? "Archive this installation in this organization. The publisher and other organizations are unaffected."
                : "Archiving stops new installations and product changes. Existing access and app clients keep working."}
        </p>
      </div>
      <div className="product-lifecycle-actions">
        {!isArchived ? (
          <button
            aria-haspopup="dialog"
            className="button button-secondary"
            onClick={openDialog}
            type="button"
          >
            Archive product
          </button>
        ) : (
          <>
            {!deletionInProgress ? (
              <form action="/actions/restoreOrganizationProductAction" method="post">
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="productRecordId" value={product.productRecordId} />
                <input type="hidden" name="productId" value={product.productId} />
                <button className="button button-secondary" type="submit">
                  Restore product
                </button>
              </form>
            ) : null}
            <button
              aria-haspopup="dialog"
              className="button button-danger"
              onClick={openDialog}
              type="button"
            >
              {deletionInProgress ? "Retry deletion" : "Delete product"}
            </button>
          </>
        )}
      </div>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        open={isOpen}
        title={
          isArchived
            ? isSharedInstallation
              ? "Delete this archived installation?"
              : "Delete this archived product?"
            : isSharedInstallation
              ? "Archive this installation?"
              : "Archive this product?"
        }
        description={
          isArchived
            ? isSharedInstallation
              ? "This permanently removes the product from this organization and revokes its local members, permissions, invitations, integrations, and API keys. The publisher, other organizations, shared accounts, and the app’s own data are unaffected."
              : "This permanently removes the product from Perminister, revokes its members, permissions, invitations, integrations, app clients, sessions, and API keys, and removes its shared installations. It does not delete shared accounts or the connected app’s data."
            : isSharedInstallation
              ? "This hides the installation from active product lists and blocks changes here. Existing access remains active, and the publisher and other organizations are unaffected. You can restore it later."
              : "This hides the product from active lists and shared-product discovery, and blocks product changes. Existing access and app clients remain active. You can restore it later."
        }
      >
        {isArchived && adopterOrganizations.length ? (
          <>
            <p>These organizations will lose access:</p>
            <ul className="product-privacy-organization-list">
              {adopterOrganizations.map((organization) => (
                <li key={organization.organizationId}>{organization.name}</li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" onClick={closeDialog} type="button">
            Cancel
          </button>
          {isArchived ? (
            <form action="/actions/deleteOrganizationProductAction" method="post">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="productRecordId" value={product.productRecordId} />
              <input type="hidden" name="productId" value={product.productId} />
              <input type="hidden" name="confirmedRemoval" value="true" />
              <button className="button button-danger" type="submit">
                {deletionInProgress
                  ? "Retry deletion"
                  : isSharedInstallation
                    ? "Delete from this organization"
                    : "Delete product"}
              </button>
            </form>
          ) : (
            <form action="/actions/archiveOrganizationProductAction" method="post">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="productRecordId" value={product.productRecordId} />
              <input type="hidden" name="productId" value={product.productId} />
              <button className="button button-primary" type="submit">
                {isSharedInstallation ? "Archive installation" : "Archive product"}
              </button>
            </form>
          )}
        </div>
      </AlertDialog>
    </section>
  );
}
