"use client";

import type { ReactNode } from "react";
import { AlertDialog } from "panel-frame-ui";
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
  const { isOpen, openDialog, closeDialog } = useModalDialog();

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
      <AlertDialog
        description={description}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        open={isOpen}
        title={title}
      >
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" onClick={closeDialog} type="button">
            Cancel
          </button>
          {children}
        </div>
      </AlertDialog>
    </>
  );
}
