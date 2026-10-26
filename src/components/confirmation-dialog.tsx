"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import { useModalDialog } from "@/components/use-modal-dialog";

export function ConfirmationDialog({
  triggerLabel,
  title,
  description,
  children,
  triggerClassName = "button button-secondary",
}: {
  triggerLabel: string;
  title: string;
  description: string;
  children: ReactNode;
  triggerClassName?: string;
}) {
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const dialogId = useId();

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
          {children}
        </div>
      </dialog>
    </>
  );
}
