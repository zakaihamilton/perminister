"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function MobileNavDrawer({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <div className="dashboard-mobile-bar">
        <button
          type="button"
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
