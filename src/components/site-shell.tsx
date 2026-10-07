import { ThemeControl } from "@/components/theme-control";
import { getCurrentSession } from "@/lib/auth/service";
import Link from "next/link";

type ActivePage = "home" | "dashboard" | "developers" | "none";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      className={`brand${compact ? " brand-compact" : ""}`}
      href="/"
      aria-label="Perminister home"
    >
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M20 3.5 34 9v10.4c0 8.1-5.7 13.9-14 17.1C11.7 33.3 6 27.5 6 19.4V9l14-5.5Z" />
          <path d="m13.2 19.8 4.3 4.3 9.5-9.6" />
          <circle cx="29.8" cy="10.2" r="2.4" />
        </svg>
      </span>
      <span className="brand-word">
        Perminister<span className="brand-period">.</span>
      </span>
    </Link>
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
          <Link href="/" aria-current={active === "home" ? "page" : undefined}>
            Overview
          </Link>
          <Link href="/developers" aria-current={active === "developers" ? "page" : undefined}>
            Developers
          </Link>
          {signedIn ? (
            <Link href="/dashboard" aria-current={active === "dashboard" ? "page" : undefined}>
              Dashboard
            </Link>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </nav>
        <ThemeControl />
        {!signedIn ? (
          <Link className="header-create" href="/register">
            Create account
          </Link>
        ) : null}
      </div>
    </header>
  );
}

export type DeveloperSection = "overview" | "getting-started" | "permissions" | "api-keys";

const developerSections: ReadonlyArray<{ id: DeveloperSection; label: string; href: string }> = [
  { id: "overview", label: "Overview", href: "/developers" },
  { id: "getting-started", label: "Getting started", href: "/developers/getting-started" },
  { id: "permissions", label: "Permissions", href: "/developers/permissions" },
  { id: "api-keys", label: "API keys", href: "/developers/api-keys" },
];

export function DeveloperGuideNav({ active }: { active: DeveloperSection }) {
  return (
    <nav className="developer-nav" aria-label="Developer guide sections">
      {developerSections.map((section) => (
        <Link
          href={section.href}
          key={section.id}
          aria-current={active === section.id ? "page" : undefined}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Brand compact />
      <p>Products, people, and access in one place.</p>
      <nav className="footer-links" aria-label="Footer links">
        <Link href="/privacy">Privacy Policy</Link>
        <a
          className="footer-github-link"
          href="https://github.com/zakaihamilton/perminister"
          aria-label="Perminister GitHub repository"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.16c-3.21.7-3.89-1.36-3.89-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.28 1.2-3.09-.12-.29-.52-1.46.12-3.04 0 0 .97-.31 3.16 1.18a10.98 10.98 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.24 2.75.12 3.04.74.81 1.19 1.83 1.19 3.1 0 4.42-2.7 5.4-5.27 5.68.42.36.79 1.06.79 2.14v3.18c0 .31.2.67.8.56A11.5 11.5 0 0 0 12 .5Z"
            />
          </svg>
        </a>
      </nav>
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
