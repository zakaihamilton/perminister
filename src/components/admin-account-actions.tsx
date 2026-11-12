"use client";

import { AlertDialog } from "panel-frame-ui";
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
  const { isOpen, openDialog, closeDialog } = useModalDialog();

  return (
    <div className="admin-account-actions">
      <form action="/actions/updateAccountStatusAction" method="post">
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
          <AlertDialog
            description={
              "This permanently removes the account’s personal details and sign-in access. Its organization and product memberships will be removed, and its API keys will be revoked. Activity history remains available. Transfer ownership first if this is the only active owner of an organization or product."
            }
            onOpenChange={(open) => {
              if (!open) closeDialog();
            }}
            open={isOpen}
            title={`Delete ${email ?? "this account"}?`}
          >
            <div className="product-privacy-dialog-actions">
              <button className="button button-secondary" type="button" onClick={closeDialog}>
                Cancel
              </button>
              <form action="/actions/deleteAccountAction" method="post">
                <input type="hidden" name="subjectId" value={subjectId} />
                <button className="button button-danger" type="submit">
                  Permanently delete account
                </button>
              </form>
            </div>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
