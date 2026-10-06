"use client";

import { cloneElement, useEffect, useId, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";

export function Tooltip({
  content,
  children,
  label = "More information",
  trigger,
}: {
  content: string;
  children?: ReactNode;
  label?: string;
  trigger?: ReactElement<ComponentProps<"button">>;
}) {
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const triggerContent = trigger
    ? cloneElement(trigger, {
        "aria-describedby": [trigger.props["aria-describedby"], id].filter(Boolean).join(" "),
        onPointerDown: (event) => {
          trigger.props.onPointerDown?.(event);
          if (event.pointerType === "touch") setOpen((value) => !value);
        },
      })
    : (
        <button
          aria-describedby={id}
          aria-label={label}
          className="tooltip-trigger"
          onPointerDown={(event) => {
            if (event.pointerType === "touch") setOpen((value) => !value);
          }}
          type="button"
        >
          {children ?? <span aria-hidden="true">i</span>}
        </button>
      );

  return (
    <span
      className="tooltip-anchor"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") setOpen(false);
      }}
      ref={rootRef}
    >
      {triggerContent}
      <span className="tooltip-bubble" hidden={!open} id={id} role="tooltip">{content}</span>
    </span>
  );
}
