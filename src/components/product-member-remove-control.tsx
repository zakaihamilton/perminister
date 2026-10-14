"use client";

import { useId } from "react";
import { useModalDialog } from "@/components/use-modal-dialog";

export function ProductMemberRemoveControl({
  organizationId,
  productId,
  subjectId,
  memberLabel,
}: {
  organizationId: string;
  productId: string;
  subjectId: string;
  memberLabel: string;
}) {
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const dialogId = useId();

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="button button-secondary"
        onClick={openDialog}
        type="button"
      >
        Remove member
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
        <h2 id={`${dialogId}-title`}>Remove {memberLabel} from this product?</h2>
        <p id={`${dialogId}-description`}>
          This disables their product membership and permission grants, and revokes their active API
          keys for this product. You can invite them again later.
        </p>
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" onClick={closeDialog} type="button">
            Cancel
          </button>
          <form action="/actions/removeProductMemberAction" method="post">
            <input name="organizationId" type="hidden" value={organizationId} />
            <input name="productId" type="hidden" value={productId} />
            <input name="subjectId" type="hidden" value={subjectId} />
            <button className="button button-danger" type="submit">
              Remove member
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
