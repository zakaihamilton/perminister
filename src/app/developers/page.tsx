import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { ArrowUpRight, CheckIcon } from "@/components/site-shell";

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m12 3 9 16H3l9-16Z" />
      <path d="M12 9v4m0 3h.01" />
    </svg>
  );
}

const sections = [
  {
    href: "/developers/getting-started",
    number: "01",
    title: "Getting started",
    description: "Integration boundaries, sign-in flow, and explicit legacy-account linking.",
  },
  {
    href: "/developers/permissions",
    number: "02",
    title: "Permissions",
    description: "Product, project, and workspace scopes with server-side enforcement guidance.",
  },
  {
    href: "/developers/api-keys",
    number: "03",
    title: "API keys",
    description: "Machine credentials, one-time secret display, and planned key lifecycle.",
  },
  {
    href: "/developers/storage",
    number: "04",
    title: "Storage & readiness",
    description: "The Spaces-only storage contract, writer model, and current operational limits.",
  },
];

export default function DevelopersPage() {
  return (
    <DeveloperGuideLayout
      active="overview"
      eyebrow="Developer guide"
      title="Build with Authodox"
      intro="Authodox provides shared human identity, sessions, scoped permissions, and API keys. Consumer applications keep their own entry points, app sessions, domain data, and resource enforcement."
    >
      <aside className="guide-notice" aria-label="Implementation status">
        <span className="callout-icon"><WarningIcon /></span>
        <p><strong>Authentication and access routes are planned, not callable yet.</strong> <code className="code-label">GET /api/health</code> is the only implemented route; it checks process liveness, not Spaces readiness. Sign-in/session, account-linking, permission-query, and API-key routes do not have a finalized contract.</p>
      </aside>

      <section className="developer-index" aria-labelledby="guide-sections-title">
        <div className="developer-index-heading">
          <h2 id="guide-sections-title">Choose a guide</h2>
          <p>Each section separates current foundation from planned integration behavior.</p>
        </div>
        <div className="developer-index-grid">
          {sections.map((section) => (
            <Link className="developer-index-card" href={section.href} key={section.href}>
              <span className="developer-index-number">{section.number}</span>
              <span className="developer-index-copy">
                <strong>{section.title}</strong>
                <span>{section.description}</span>
              </span>
              <ArrowUpRight />
            </Link>
          ))}
        </div>
      </section>

      <section className="guide-panel foundation-panel" aria-labelledby="foundation-title">
        <div className="guide-panel-head">
          <h2 id="foundation-title">Foundation in this repository</h2>
          <p>These pieces exist today; user-facing auth and key operations remain unimplemented.</p>
        </div>
        <ul className="secure-list">
          <li><CheckIcon />TypeScript / Next.js service scaffold</li>
          <li><CheckIcon />Product-neutral identity, grant, and key record types</li>
          <li><CheckIcon />Server-only Spaces record and event adapter</li>
          <li><CheckIcon />Process-liveness route at <code className="code-label">/api/health</code></li>
        </ul>
      </section>
    </DeveloperGuideLayout>
  );
}
