import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { ArrowUpRight, CheckIcon } from "@/components/site-shell";

const sections = [
  {
    href: "/developers/getting-started",
    number: "01",
    title: "Getting started",
    description: "Organization setup, products, invitations, and the current API surface.",
  },
  {
    href: "/developers/permissions",
    number: "02",
    title: "Permissions",
    description: "Product, project, and workspace grants checked against each request.",
  },
  {
    href: "/developers/api-keys",
    number: "03",
    title: "API keys",
    description: "Create, rotate, expire, and revoke server-only bearer keys.",
  },
  {
    href: "/developers/storage",
    number: "04",
    title: "Storage & readiness",
    description: "Spaces event recovery, write concurrency, and required settings.",
  },
];

export default function DevelopersPage() {
  return (
    <DeveloperGuideLayout
      active="overview"
      eyebrow="Developer guide"
      title="Build with Perminister"
      intro="Perminister provides central identities, password credentials, sessions, scoped permissions, and API keys. Consumer applications keep their branded portals, app-local sessions, domain data, and resource enforcement."
    >
      <div className="guide-notice" aria-label="Current API routes">
        <p><strong>Available now:</strong> account and key management in the dashboard, <code className="code-label">GET /api/auth/session</code> for a browser session, and <code className="code-label">POST /api/authorize</code> for bearer-key checks. <code className="code-label">GET /api/health</code> reports process liveness only.</p>
      </div>

      <section className="developer-index" aria-labelledby="guide-sections-title">
        <div className="developer-index-heading">
          <h2 id="guide-sections-title">Choose a guide</h2>
          <p>Each section covers current behavior and the configuration it needs.</p>
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
          <h2 id="foundation-title">Implemented service boundary</h2>
          <p>Perminister stores identity and access state; consumer applications own their domain data and final resource checks.</p>
        </div>
        <ul className="secure-list">
          <li><CheckIcon />Email/password accounts and revocable browser sessions</li>
          <li><CheckIcon />Organization-owned products and Owner/Admin/Member roles</li>
          <li><CheckIcon />Organization-scoped product/project/workspace grants</li>
          <li><CheckIcon />API-key lifecycle with one-time secret display</li>
          <li><CheckIcon />Private DigitalOcean Spaces records and recoverable event snapshots</li>
        </ul>
      </section>
    </DeveloperGuideLayout>
  );
}
