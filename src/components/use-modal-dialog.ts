"use client";

import { useState } from "react";

export function useModalDialog(initialOpen = false) {
  const [isOpen, setIsOpen] = useState(initialOpen);

  return {
    isOpen,
    openDialog: () => setIsOpen(true),
    closeDialog: () => setIsOpen(false),
  };
}
