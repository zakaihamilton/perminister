"use client";

import { ConfirmationDialog } from "@/components/confirmation-dialog";

interface ConfirmationActionControlProps {
  action:
    | "/actions/applyProductAccessRoleCatalogAction"
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
  triggerAriaLabel?: string;
}

export function ConfirmationActionControl({
  action,
  fields,
  triggerLabel,
  title,
  description,
  confirmLabel,
  triggerClassName = "button button-secondary",
  triggerAriaLabel,
}: ConfirmationActionControlProps) {
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
      case "/actions/applyProductAccessRoleCatalogAction":
        return (
          <form action="/actions/applyProductAccessRoleCatalogAction" method="post">
            {formContents}
          </form>
        );
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
    <ConfirmationDialog
      triggerClassName={triggerClassName}
      triggerLabel={triggerLabel}
      triggerAriaLabel={triggerAriaLabel}
      title={title}
      description={description}
    >
      {confirmationForm}
    </ConfirmationDialog>
  );
}
