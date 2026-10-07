"use client";

import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useCloseOnOutsidePointerDown(open, rootRef, setOpen);

  useEffect(() => {
    if (!open) return;
    const anchor = rootRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;

    const positionBubble = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const margin = 12;
      const gap = 9;
      const clamp = (value: number, min: number, max: number) =>
        Math.min(Math.max(value, min), Math.max(min, max));

      const left = clamp(
        anchorRect.left + (anchorRect.width - bubbleRect.width) / 2,
        margin,
        viewportWidth - margin - bubbleRect.width,
      );
      const spaceAbove = anchorRect.top - margin - gap;
      const spaceBelow = viewportHeight - anchorRect.bottom - margin - gap;
      const placeAbove =
        spaceAbove >= bubbleRect.height ||
        (spaceBelow < bubbleRect.height && spaceAbove >= spaceBelow);
      const desiredTop = placeAbove
        ? anchorRect.top - gap - bubbleRect.height
        : anchorRect.bottom + gap;
      const top = clamp(desiredTop, margin, viewportHeight - margin - bubbleRect.height);

      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      bubble.style.visibility = "visible";
    };

    positionBubble();
    window.addEventListener("resize", positionBubble);
    window.addEventListener("scroll", positionBubble, true);
    window.visualViewport?.addEventListener("resize", positionBubble);
    window.visualViewport?.addEventListener("scroll", positionBubble);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionBubble);
    resizeObserver?.observe(anchor);
    resizeObserver?.observe(bubble);

    return () => {
      window.removeEventListener("resize", positionBubble);
      window.removeEventListener("scroll", positionBubble, true);
      window.visualViewport?.removeEventListener("resize", positionBubble);
      window.visualViewport?.removeEventListener("scroll", positionBubble);
      resizeObserver?.disconnect();
    };
  }, [content, open]);

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
    <>
      <span className="tooltip-anchor" ref={rootRef}>
        {triggerContent}
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
