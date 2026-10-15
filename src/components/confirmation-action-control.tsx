"use client";

import { useId } from "react";
import { useModalDialog } from "@/components/use-modal-dialog";

interface ConfirmationActionControlProps {
  action:
    | "/actions/removeProductAccessRoleAction"
    | "/actions/revokeProductInvitationAction"
    | "/actions/revokeOrganizationInvitationAction"
    | "/actions/removeOrganizationMemberAction"
    | "/actions/retireLegacyAccessAction"
    | "/actions/revokeApiKeyAction";
  fields: readonly { name: string; value: string }[];
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  triggerClassName?: string;
}

export function ConfirmationActionControl({
  action,
  fields,
  triggerLabel,
  title,
  description,
  confirmLabel,
  triggerClassName = "button button-secondary",
}: ConfirmationActionControlProps) {
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const dialogId = useId();
  const formContents = (
    <>
      {fields.map((field) => (
        <input key={field.name} name={field.name} type="hidden" value={field.value} />
      ))}
      <button className="button button-danger" type="submit">
        {confirmLabel}
      </button>
    </>
  );
  const confirmationForm = (() => {
    switch (action) {
      case "/actions/removeProductAccessRoleAction":
        return (
          <form action="/actions/removeProductAccessRoleAction" method="post">
            {formContents}
          </form>
        );
      case "/actions/revokeProductInvitationAction":
        return (
          <form action="/actions/revokeProductInvitationAction" method="post">
            {formContents}
          </form>
        );
      case "/actions/revokeOrganizationInvitationAction":
        return (
          <form action="/actions/revokeOrganizationInvitationAction" method="post">
            {formContents}
          </form>
        );
      case "/actions/removeOrganizationMemberAction":
        return (
          <form action="/actions/removeOrganizationMemberAction" method="post">
            {formContents}
          </form>
        );
      case "/actions/retireLegacyAccessAction":
        return (
          <form action="/actions/retireLegacyAccessAction" method="post">
            {formContents}
          </form>
        );
      case "/actions/revokeApiKeyAction":
        return (
          <form action="/actions/revokeApiKeyAction" method="post">
            {formContents}
          </form>
        );
      default:
        return null;
    }
  })();

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={triggerClassName}
        onClick={openDialog}
        type="button"
      >
        {triggerLabel}
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
        <h2 id={`${dialogId}-title`}>{title}</h2>
        <p id={`${dialogId}-description`}>{description}</p>
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" onClick={closeDialog} type="button">
            Cancel
          </button>
          {confirmationForm}
        </div>
      </dialog>
    </>
  );
}
