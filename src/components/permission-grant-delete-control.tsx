"use client";

import { useId } from "react";
import { useModalDialog } from "@/components/use-modal-dialog";

export function PermissionGrantDeleteControl({
  membershipId,
  organizationId,
  productId,
  memberLabel,
  scopeLabel,
  accessLabel,
  actionCount,
}: {
  membershipId: string;
  organizationId: string;
  productId: string;
  memberLabel: string;
  scopeLabel: string;
  accessLabel: string;
  actionCount: number;
}) {
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const dialogId = useId();

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="button button-danger"
        onClick={openDialog}
        type="button"
      >
        Delete permission
      </button>
      <dialog
        aria-describedby={`${dialogId}-description`}
        aria-labelledby={`${dialogId}-title`}
        className="product-privacy-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        ref={dialogRef}
      >
        <h2 id={`${dialogId}-title`}>Delete this disabled permission?</h2>
        <p id={`${dialogId}-description`}>
          This permanently removes the {accessLabel} permission for {memberLabel} at {scopeLabel}.
          It includes {actionCount} app permission{actionCount === 1 ? "" : "s"}. You can assign
          permissions again later.
        </p>
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" onClick={closeDialog} type="button">
            Cancel
          </button>
          <form action="/actions/deletePermissionGrantAction" method="post">
            <input name="organizationId" type="hidden" value={organizationId} />
            <input name="productId" type="hidden" value={productId} />
            <input name="membershipId" type="hidden" value={membershipId} />
            <button className="button button-danger" type="submit">
              Delete permission
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
