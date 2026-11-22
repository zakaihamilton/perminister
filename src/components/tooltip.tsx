"use client";

import { Tooltip as PanelTooltip } from "panel-frame-ui";
import type { ComponentProps, ReactNode } from "react";

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
  return (
    <PanelTooltip
      content={content}
      label={label}
      triggerProps={triggerProps}
      wrapperClassName="tooltip-anchor"
    >
      {children}
    </PanelTooltip>
  );
}
