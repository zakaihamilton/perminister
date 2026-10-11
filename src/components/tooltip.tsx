"use client";

import { useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCloseOnOutsidePointerDown } from "@/components/use-close-on-outside-pointer-down";
import { useTooltipPositioning } from "@/components/use-tooltip-positioning";

export function Tooltip({
  content,
  children,
  label = "More information",
  triggerProps,
}: {
  content: string;
  children?: ReactNode;
  label?: string;
  triggerProps?: Omit<ComponentProps<"button">, "children">;
}) {
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useCloseOnOutsidePointerDown(open, rootRef, setOpen);
  useTooltipPositioning(open, content, rootRef, bubbleRef);

  const buttonProps: ComponentProps<"button"> = {
    ...triggerProps,
    "aria-describedby": [triggerProps?.["aria-describedby"], id].filter(Boolean).join(" "),
    "aria-label": triggerProps?.["aria-label"] ?? label,
    onBlur: (event) => {
      triggerProps?.onBlur?.(event);
      setOpen(false);
    },
    onFocus: (event) => {
      triggerProps?.onFocus?.(event);
      setOpen(true);
    },
    onKeyDown: (event) => {
      triggerProps?.onKeyDown?.(event);
      if (event.key === "Escape") setOpen(false);
    },
    onPointerDown: (event) => {
      triggerProps?.onPointerDown?.(event);
      if (event.pointerType === "touch") setOpen((value) => !value);
    },
    onPointerEnter: (event) => {
      triggerProps?.onPointerEnter?.(event);
      if (event.pointerType !== "touch") setOpen(true);
    },
    onPointerLeave: (event) => {
      triggerProps?.onPointerLeave?.(event);
      if (event.pointerType !== "touch") setOpen(false);
    },
  };
  const { className, type, ...restButtonProps } = buttonProps;

  return (
    <>
      <span className="tooltip-anchor" ref={rootRef}>
        <button
          {...restButtonProps}
          className={className ?? "tooltip-trigger"}
          type={type ?? "button"}
        >
          {children ?? <span aria-hidden="true">i</span>}
        </button>
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span className="tooltip-bubble" id={id} ref={bubbleRef} role="tooltip">
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
