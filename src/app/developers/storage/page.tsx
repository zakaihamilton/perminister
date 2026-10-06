import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon, LockIcon } from "@/components/site-shell";

export default function StoragePage() {
  return (
    <DeveloperGuideLayout
      active="storage"
      eyebrow="Developer guide / Storage & readiness"
      title="Spaces is the only store"
      intro="Perminister persists private records and event objects in DigitalOcean Spaces through its S3-compatible API. There is no database or local-storage fallback."
    >
      <div className="guide-grid">
        <div className="guide-main">
          <section className="guide-panel" aria-labelledby="boundary-title">
            <div className="guide-panel-head">
              <h2 id="boundary-title">Storage boundary</h2>
              <p>Consumer applications use future Perminister interfaces. They do not receive bucket credentials or access the bucket directly.</p>
            </div>
            <div className="storage-facts">
              <div className="storage-fact"><span>Persistence</span><strong>Private DigitalOcean Space</strong></div>
              <div className="storage-fact"><span>Region</span><strong>SFO3</strong></div>
              <div className="storage-fact"><span>Example bucket</span><strong>perminister</strong></div>
              <div className="storage-fact"><span>Record keys</span><strong>Opaque UUIDs</strong></div>
              <div className="storage-fact"><span>Credential access</span><strong>Server-side only</strong></div>
            </div>
            <p className="storage-config-note">The non-secret endpoint, region, and bucket are in <code className="code-label">.env.example</code>. Add credentials only to local server configuration; never expose them through a public environment variable.</p>
          </section>

          <section className="guide-panel" aria-labelledby="recovery-title">
            <div className="guide-panel-head">
              <h2 id="recovery-title">Writes need one active process</h2>
              <p>The current mutation queue serializes work inside one Node.js process only. It is not distributed coordination.</p>
            </div>
            <div className="steps">
              <article className="step"><span className="step-number">01</span><div><h3>Run a single long-lived writer</h3><p>Multiple replicas, serverless execution, rolling overlap, or automatic failover violate the current assumption.</p></div></article>
              <article className="step"><span className="step-number">02</span><div><h3>Enable recovery support</h3><p>Object versioning and a separate backup are required before writes are enabled. Spaces does not provide a cross-object transaction.</p></div></article>
              <article className="step"><span className="step-number">03</span><div><h3>Recover uncertain writes before retrying</h3><p>Event append and record snapshot writes need a replay path. Automated recovery is not implemented, so state-changing auth flows remain disabled.</p></div></article>
            </div>
          </section>
        </div>

        <aside className="guide-aside" aria-label="Current readiness">
          <section className="aside-card">
            <span className="key-callout-icon"><LockIcon /></span>
            <h2>Ready in the repository</h2>
            <ul className="secure-list">
              <li><CheckIcon />Server-only S3 SDK adapter for versioned records and event objects.</li>
              <li><CheckIcon />Serialized mutation queue for one process.</li>
              <li><CheckIcon />Credential-field checks reject plaintext secrets in stored records.</li>
            </ul>
          </section>
          <section className="aside-card readiness-card">
            <h2>Still planned or unresolved</h2>
            <ul className="planned-list">
              <li>Sign-in, session, account-linking, permission, and API-key routes</li>
              <li>Mutation replay and automated recovery</li>
              <li>Cache maximum age and outage behavior</li>
              <li>Deployment guarantee for one active writer</li>
            </ul>
          </section>
          <p className="health-note">The only current route, <code className="code-label">GET /api/health</code>, checks that the process responds. It does not check Spaces connectivity or readiness.</p>
        </aside>
      </div>
      <p className="guide-next-link">Return to the <Link href="/developers">developer guide overview</Link>.</p>
    </DeveloperGuideLayout>
  );
}
