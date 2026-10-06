"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/tooltip";

export type ThemeChoice = "system" | "light" | "dark";

const storageKey = "perminister-theme";
const themeOptions: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

function resolvedTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = resolvedTheme(choice);
}

export function ThemeControl() {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let initial: ThemeChoice = "system";
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (isThemeChoice(stored)) initial = stored;
    } catch {
      // Keep the system preference when browser storage is unavailable.
    }
    setChoice(initial);
    applyTheme(initial);

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next = isThemeChoice(event.newValue) ? event.newValue : "system";
      setChoice(next);
      applyTheme(next);
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => applyTheme("system");
    media.addEventListener("change", handleSystemChange);
    return () => media.removeEventListener("change", handleSystemChange);
  }, [choice]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = themeOptions.findIndex((option) => option.value === choice);
    optionRefs.current[selectedIndex]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, choice]);

  function chooseTheme(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // The selected theme still applies for this page view.
    }
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const currentIndex = optionRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + themeOptions.length) % themeOptions.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + themeOptions.length) % themeOptions.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = themeOptions.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      optionRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <div className="theme-control" ref={rootRef}>
      <Tooltip
        content="Choose light, dark, or system appearance. Your choice is saved on this device."
        trigger={
          <button
            aria-controls={open ? "theme-menu" : undefined}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={`Appearance: ${themeOptions.find((option) => option.value === choice)?.label ?? "System"}`}
            className="theme-trigger"
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !open) {
                event.preventDefault();
                setOpen(true);
              }
            }}
            ref={triggerRef}
            type="button"
          >
            <ThemeIcon choice={choice} />
            <span className="theme-trigger-label">Theme</span>
            <svg aria-hidden="true" className="theme-chevron" viewBox="0 0 16 16" fill="none">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        }
      />
      {open ? (
        <div aria-label="Choose appearance" className="theme-menu" id="theme-menu" onKeyDown={handleMenuKeyDown} role="menu">
          <span className="theme-menu-label">Appearance</span>
          {themeOptions.map((option, index) => (
            <button
              aria-checked={choice === option.value}
              className="theme-menu-option"
              key={option.value}
              onClick={() => chooseTheme(option.value)}
              ref={(element) => { optionRefs.current[index] = element; }}
              role="menuitemradio"
              type="button"
            >
              <span>{option.label}</span>
              {choice === option.value ? <span aria-hidden="true" className="theme-menu-check">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "dark") {
    return <svg aria-hidden="true" className="theme-icon" viewBox="0 0 20 20" fill="none"><path d="M16.2 12.1A6.7 6.7 0 0 1 7.9 3.8a6.8 6.8 0 1 0 8.3 8.3Z" /></svg>;
  }
  if (choice === "light") {
    return <svg aria-hidden="true" className="theme-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3.2" /><path d="M10 1.7v2m0 12.6v2M1.7 10h2m12.6 0h2M4.1 4.1l1.4 1.4m9 9 1.4 1.4m0-11.8-1.4 1.4m-9 9-1.4 1.4" /></svg>;
  }
  return <svg aria-hidden="true" className="theme-icon" viewBox="0 0 20 20" fill="none"><rect x="2.2" y="3.4" width="15.6" height="10.6" rx="1.5" /><path d="M7 16.6h6m-3-2.6v2.6" /></svg>;
}
