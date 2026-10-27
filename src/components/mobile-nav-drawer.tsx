"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function MobileNavDrawer({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close drawer automatically upon route changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer is open on mobile
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const drawer = drawerRef.current;
    const trigger = triggerRef.current;
    drawer?.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const items = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((item) => item.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !drawer.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !drawer.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <div className="dashboard-mobile-bar">
        <button
          type="button"
          ref={triggerRef}
          className="dashboard-mobile-menu-trigger"
          aria-expanded={isOpen}
          aria-controls="mobile-nav-drawer"
          aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span className="mobile-menu-icon" aria-hidden="true">
            <span className={`bar ${isOpen ? "open" : ""}`} />
            <span className={`bar ${isOpen ? "open" : ""}`} />
            <span className={`bar ${isOpen ? "open" : ""}`} />
          </span>
          <span className="mobile-menu-label">{isOpen ? "Close" : "Menu"}</span>
        </button>
      </div>

      {isOpen ? (
        <div
          className="dashboard-drawer-backdrop"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <div
        ref={drawerRef}
        inert={!isOpen}
        id="mobile-nav-drawer"
        className={`dashboard-mobile-drawer ${isOpen ? "is-open" : ""}`}
        aria-hidden={!isOpen}
      >
        <div className="dashboard-drawer-inner">
          <div className="dashboard-drawer-header">
            <span className="dashboard-drawer-title">Navigation</span>
            <button
              type="button"
              className="dashboard-drawer-close"
              aria-label="Close menu"
              onClick={() => setIsOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="dashboard-drawer-content">{children}</div>
        </div>
      </div>
    </>
  );
}
