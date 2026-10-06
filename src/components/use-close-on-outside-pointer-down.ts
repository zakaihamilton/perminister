"use client";

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

export function useCloseOnOutsidePointerDown<Element extends HTMLElement>(
  open: boolean,
  rootRef: RefObject<Element | null>,
  setOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, rootRef, setOpen]);
}
