"use client";

import { useEffect, useRef, useState } from "react";

export function useModalDialog(initialOpen = false) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return {
    dialogRef,
    openDialog: () => setIsOpen(true),
    closeDialog: () => setIsOpen(false),
  };
}
