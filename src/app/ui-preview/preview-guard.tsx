"use client";

import type { MouseEvent, ReactNode } from "react";

function guardNavigation(event: MouseEvent<HTMLDivElement>) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest("a");
  if (link && !link.closest(".ui-preview-toolbar")) {
    event.preventDefault();
    event.stopPropagation();
  }
}

export function PreviewGuard({ children }: { children: ReactNode }) {
  return (
    <div
      onSubmitCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClickCapture={guardNavigation}
      onAuxClickCapture={guardNavigation}
      onContextMenuCapture={guardNavigation}
    >
      {children}
    </div>
  );
}
