import { ThemeControl } from "@/components/theme-control";
import { getCurrentSession } from "@/lib/auth/service";

type ActivePage = "home" | "dashboard" | "developers" | "none";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`brand${compact ? " brand-compact" : ""}`} href="/" aria-label="Perminister home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M20 3.5 34 9v10.4c0 8.1-5.7 13.9-14 17.1C11.7 33.3 6 27.5 6 19.4V9l14-5.5Z" />
          <path d="m13.2 19.8 4.3 4.3 9.5-9.6" />
          <circle cx="29.8" cy="10.2" r="2.4" />
        </svg>
      </span>
      <span className="brand-word">Perminister<span className="brand-period">.</span></span>
    </a>
  );
}

export async function SiteHeader({
  active,
  authenticated,
}: {
  active: ActivePage;
  authenticated?: boolean;
}) {
  const signedIn = authenticated ?? !!(await getCurrentSession());

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav className="primary-nav" aria-label="Main navigation">
          <a href="/" aria-current={active === "home" ? "page" : undefined}>Overview</a>
          <a href="/developers" aria-current={active === "developers" ? "page" : undefined}>Developers</a>
          {signedIn
            ? <a href="/dashboard" aria-current={active === "dashboard" ? "page" : undefined}>Dashboard</a>
            : <a href="/login">Sign in</a>}
        </nav>
        <ThemeControl />
        {!signedIn ? <a className="header-create" href="/register">Create account</a> : null}
      </div>
    </header>
  );
}

export type DeveloperSection =
  | "overview"
  | "getting-started"
  | "permissions"
  | "api-keys"
  | "storage";

const developerSections: ReadonlyArray<{ id: DeveloperSection; label: string; href: string }> = [
  { id: "overview", label: "Overview", href: "/developers" },
  { id: "getting-started", label: "Getting started", href: "/developers/getting-started" },
  { id: "permissions", label: "Permissions", href: "/developers/permissions" },
  { id: "api-keys", label: "API keys", href: "/developers/api-keys" },
  { id: "storage", label: "Storage & readiness", href: "/developers/storage" },
];

export function DeveloperGuideNav({ active }: { active: DeveloperSection }) {
  return (
    <nav className="developer-nav" aria-label="Developer guide sections">
      {developerSections.map((section) => (
        <a
          href={section.href}
          key={section.id}
          aria-current={active === section.id ? "page" : undefined}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Brand compact />
      <p>Products, people, and access in one place.</p>
      <span className="footer-note">Perminister · identity and access</span>
    </footer>
  );
}

export function ArrowUpRight() {
  return (
    <svg className="arrow-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M5 15 15 5M6 5h9v9" />
    </svg>
  );
}

export function ArrowRight() {
  return (
    <svg className="arrow-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M3.5 10h13m-5-5 5 5-5 5" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <rect x="4.5" y="10" width="15" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3" />
    </svg>
  );
}

export function LayersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}

export function KeyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <circle cx="8" cy="15" r="5" />
      <path d="m11.5 11.5 8-8 2 2-2 2 2 2-3 3-2-2-1.5 1.5M8 15h.01" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="m4 10.5 4 4L16 6" />
    </svg>
  );
}
