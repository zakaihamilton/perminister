"use client";

import { ThemeControl as PanelThemeControl } from "panel-frame-ui";

export { type ThemeChoice } from "panel-frame-ui";

export function ThemeControl() {
  return <PanelThemeControl className="theme-control" label="Theme" />;
}
