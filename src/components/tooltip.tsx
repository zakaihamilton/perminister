"use client";

import {
  cloneElement,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { useCloseOnOutsidePointerDown } from "@/components/use-close-on-outside-pointer-down";

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

  useCloseOnOutsidePointerDown(open, rootRef, setOpen);

  const buttonProps: ComponentProps<"button"> = {
    "aria-describedby": [trigger?.props["aria-describedby"], id].filter(Boolean).join(" "),
    "aria-label": trigger ? trigger.props["aria-label"] : label,
    onBlur: (event) => {
      trigger?.props.onBlur?.(event);
      setOpen(false);
    },
    onFocus: (event) => {
      trigger?.props.onFocus?.(event);
      setOpen(true);
    },
    onKeyDown: (event) => {
      trigger?.props.onKeyDown?.(event);
      if (event.key === "Escape") setOpen(false);
    },
    onPointerDown: (event) => {
      trigger?.props.onPointerDown?.(event);
      if (event.pointerType === "touch") setOpen((value) => !value);
    },
    onPointerEnter: (event) => {
      trigger?.props.onPointerEnter?.(event);
      if (event.pointerType !== "touch") setOpen(true);
    },
    onPointerLeave: (event) => {
      trigger?.props.onPointerLeave?.(event);
      if (event.pointerType !== "touch") setOpen(false);
    },
  };

  const triggerContent = trigger ? (
    cloneElement(trigger, buttonProps)
  ) : (
    <button aria-label={label} className="tooltip-trigger" type="button" {...buttonProps}>
      {children ?? <span aria-hidden="true">i</span>}
    </button>
  );

  return (
    <span className="tooltip-anchor" ref={rootRef}>
      {triggerContent}
      <span className="tooltip-bubble" hidden={!open} id={id} role="tooltip">
        {content}
      </span>
    </span>
  );
}
