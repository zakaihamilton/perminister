import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon, LockIcon } from "@/components/site-shell";

export default function StoragePage() {
  return (
    <DeveloperGuideLayout
      active="storage"
      eyebrow="Developer guide / Storage & readiness"
      title="Spaces is the only store"
      intro="Perminister persists identities, password verifiers, sessions, grants, API-key verifiers, and audit events in the configured private DigitalOcean Spaces bucket. There is no database fallback."
    >
      <div className="guide-grid">
        <div className="guide-main">
          <section className="guide-panel" aria-labelledby="boundary-title">
            <div className="guide-panel-head">
              <h2 id="boundary-title">Storage boundary</h2>
              <p>Only server code receives Spaces credentials. Browser clients and consumer applications never access the bucket directly.</p>
            </div>
            <div className="storage-facts">
              <div className="storage-fact"><span>Persistence</span><strong>Private DigitalOcean Space</strong></div>
              <div className="storage-fact"><span>Region</span><strong>SFO3</strong></div>
              <div className="storage-fact"><span>Bucket</span><strong>perminister</strong></div>
              <div className="storage-fact"><span>Object IDs</span><strong>Opaque UUIDs</strong></div>
              <div className="storage-fact"><span>Credentials</span><strong>Server-side only</strong></div>
            </div>
            <p className="storage-config-note">Set <code className="code-label">PERMINISTER_SPACES_ACCESS_KEY</code> and <code className="code-label">PERMINISTER_SPACES_SECRET_KEY</code> securely. Keep both credential values blank in templates and out of public environment variables.</p>
          </section>

          <section className="guide-panel" aria-labelledby="recovery-title">
            <div className="guide-panel-head">
              <h2 id="recovery-title">Recoverable mutations and write boundary</h2>
              <p>Each mutation appends a versioned event before replacing its record snapshot. A later read replays the newest full-record event if the snapshot is missing or stale.</p>
            </div>
            <div className="steps">
              <article className="step"><span className="step-number">01</span><div><h3>Issue admin changes one at a time</h3><p>The process-local queue is not a distributed lock. This low-volume operating assumption limits operator overlap, but multiple Vercel instances can still race against the same Spaces objects.</p></div></article>
              <article className="step"><span className="step-number">02</span><div><h3>Enable recovery support</h3><p>Enable Spaces object versioning and keep a separate backup before production writes. Spaces does not provide cross-object transactions.</p></div></article>
              <article className="step"><span className="step-number">03</span><div><h3>Inspect partial multi-record actions</h3><p>Account registration, password recovery, and key rotation can span several records. If a response is lost, inspect event history before retrying or manually repairing state.</p></div></article>
            </div>
          </section>
        </div>

        <aside className="guide-aside" aria-label="Operational setup">
          <section className="aside-card">
            <span className="key-callout-icon"><LockIcon /></span>
            <h2>Required storage settings</h2>
            <ul className="secure-list">
              <li><CheckIcon /><code>PERMINISTER_SPACES_ENDPOINT</code> = bucket HTTPS endpoint</li>
              <li><CheckIcon /><code>PERMINISTER_SPACES_REGION</code> = sfo3</li>
              <li><CheckIcon /><code>PERMINISTER_SPACES_BUCKET</code> = perminister</li>
              <li><CheckIcon />Spaces access key and secret in server environment</li>
            </ul>
          </section>
          <section className="aside-card readiness-card">
            <h2>Accepted Vercel write risk</h2>
            <p>Vercel Functions may scale to multiple concurrent instances. Administrator changes are expected to be issued one at a time, but the process-local queue cannot prevent a cross-instance race.</p>
          </section>
          <section className="aside-card">
            <h2>Optional email settings</h2>
            <p>Password recovery and verification require <code>RESEND_API_KEY</code>, <code>PERMINISTER_MAIL_FROM</code>, and <code>PERMINISTER_PUBLIC_ORIGIN</code>. Resend must accept the configured sender; missing configuration means no email is sent.</p>
          </section>
          <section className="aside-card">
            <h2>Optional product search</h2>
            <p><code>BRAVE_SEARCH_API_KEY</code> enables server-side name search during product setup. Importing directly from a public HTTPS website does not require this setting.</p>
          </section>
          <p className="health-note"><code className="code-label">GET /api/health</code> reports process liveness. <code className="code-label">GET /api/auth/session</code> reports the browser session. See <Link href="/developers/getting-started">setup details</Link>.</p>
        </aside>
      </div>
      <p className="guide-next-link">Return to the <Link href="/developers">developer guide overview</Link>.</p>
    </DeveloperGuideLayout>
  );
}
