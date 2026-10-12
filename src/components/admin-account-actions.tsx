"use client";

import { useId } from "react";
import { deleteAccountAction, updateAccountStatusAction } from "@/app/actions";
import { useModalDialog } from "@/components/use-modal-dialog";

export function AdminAccountActions({
  subjectId,
  email,
  status,
}: {
  subjectId: string;
  email: string | null;
  status: "active" | "disabled";
}) {
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const dialogId = useId();

  return (
    <div className="admin-account-actions">
      <form action={updateAccountStatusAction}>
        <input type="hidden" name="subjectId" value={subjectId} />
        <input type="hidden" name="status" value={status === "active" ? "disabled" : "active"} />
        <button className="button button-secondary" type="submit">
          {status === "active" ? "Disable account" : "Enable account"}
        </button>
      </form>
      {status === "disabled" ? (
        <>
          <button className="button button-danger" type="button" onClick={openDialog}>
            Delete account
          </button>
          <dialog
            className="product-privacy-dialog"
            ref={dialogRef}
            aria-labelledby={`${dialogId}-title`}
            aria-describedby={`${dialogId}-description`}
            onCancel={(event) => {
              event.preventDefault();
              closeDialog();
            }}
          >
            <h2 id={`${dialogId}-title`}>Delete {email ?? "this account"}?</h2>
            <p id={`${dialogId}-description`}>
              This permanently removes the account’s personal details and sign-in access. Its
              organization and product memberships will be removed, and its API keys will be
              revoked. Activity history remains available. Transfer ownership first if this is the
              only active owner of an organization or product.
            </p>
            <div className="product-privacy-dialog-actions">
              <button className="button button-secondary" type="button" onClick={closeDialog}>
                Cancel
              </button>
              <form action={deleteAccountAction}>
                <input type="hidden" name="subjectId" value={subjectId} />
                <button className="button button-danger" type="submit">
                  Permanently delete account
                </button>
              </form>
            </div>
          </dialog>
        </>
      ) : null}
    </div>
  );
}
