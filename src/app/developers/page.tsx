import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { ArrowUpRight, CheckIcon } from "@/components/site-shell";

const sections = [
  {
    href: "/developers/getting-started",
    number: "01",
    title: "Getting started",
    description: "Connect backend sessions, choose organizations, and check protected actions.",
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
];

export default function DevelopersPage() {
  return (
    <DeveloperGuideLayout
      active="overview"
      eyebrow="Developer guide"
      title="Build with Perminister"
      intro="Share identity and access across your applications. Each app keeps its own sign-in experience, sessions, and data."
    >
      <div className="guide-notice guide-notice-wide" aria-label="Application integration boundary">
        <p>
          App backends use Perminister for shared identity and access checks. Keep application
          credentials and sessions on your server; your application owns its data and enforces
          access to its resources.
        </p>
      </div>

      <section className="developer-index" aria-labelledby="guide-sections-title">
        <div className="developer-index-heading">
          <h2 id="guide-sections-title">Choose a guide</h2>
          <p>Start with your app backend, then set up permissions and keys.</p>
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
          <h2 id="foundation-title">What Perminister provides</h2>
          <p>
            Use Perminister for shared identity and access. Your applications keep their own
            experiences, data, and resource checks.
          </p>
        </div>
        <ul className="secure-list">
          <li>
            <CheckIcon />
            Email/password accounts and revocable browser sessions
          </li>
          <li>
            <CheckIcon />
            Product teams and organization memberships
          </li>
          <li>
            <CheckIcon />
            Organization-scoped product/project/workspace grants
          </li>
          <li>
            <CheckIcon />
            API-key lifecycle with one-time secret display
          </li>
        </ul>
      </section>
    </DeveloperGuideLayout>
  );
}
