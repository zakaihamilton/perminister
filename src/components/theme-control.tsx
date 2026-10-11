"use client";

import { useEffect, useRef, useState } from "react";
import { useCloseOnOutsidePointerDown } from "@/components/use-close-on-outside-pointer-down";
import { ThemeControlTrigger, ThemeMenu, type ThemeChoice } from "@/components/theme-control-parts";

export type { ThemeChoice } from "@/components/theme-control-parts";

const storageKey = "perminister-theme";

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
    // Browser storage is read after hydration so the server and first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  useCloseOnOutsidePointerDown(open, rootRef, setOpen);

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

  return (
    <div className="theme-control" ref={rootRef}>
      <ThemeControlTrigger
        choice={choice}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        triggerRef={triggerRef}
      />
      {open ? (
        <ThemeMenu
          choice={choice}
          onChoose={chooseTheme}
          onEscape={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
