import { useEffect, type RefObject } from "react";

export function useTooltipPositioning(
  open: boolean,
  content: string,
  rootRef: RefObject<HTMLSpanElement | null>,
  bubbleRef: RefObject<HTMLSpanElement | null>,
) {
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
  }, [bubbleRef, content, open, rootRef]);
}
