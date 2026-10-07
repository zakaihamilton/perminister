import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon, LockIcon } from "@/components/site-shell";
import { withCanonical } from "@/lib/site-metadata";

export const metadata = withCanonical({
  title: "Storage and readiness",
  description:
    "Review Perminister's ID-keyed DigitalOcean Spaces layout, migration path, and concurrency limits.",
}, "/developers/storage");

export default function StoragePage() {
  return (
    <DeveloperGuideLayout
      active="storage"
      eyebrow="Developer guide / Storage & readiness"
      title="Use the object layout directly"
      intro="Perminister stores current JSON documents in a private DigitalOcean Space. Organization, product, and subject IDs are the key segments; display names and email addresses stay out of keys. There is no database fallback."
    >
      <div className="guide-grid">
        <div className="guide-main">
          <section className="guide-panel" aria-labelledby="boundary-title">
            <div className="guide-panel-head">
              <h2 id="boundary-title">Storage boundary</h2>
              <p>
                Only server code receives Spaces credentials. Browser clients and consumer
                applications never access the bucket directly.
              </p>
            </div>
            <div className="storage-facts">
              <div className="storage-fact">
                <span>Persistence</span>
                <strong>Private DigitalOcean Space</strong>
              </div>
              <div className="storage-fact">
                <span>Region</span>
                <strong>SFO3</strong>
              </div>
              <div className="storage-fact">
                <span>Bucket</span>
                <strong>perminister</strong>
              </div>
              <div className="storage-fact">
                <span>Access boundary</span>
                <strong>Members per product</strong>
              </div>
              <div className="storage-fact">
                <span>Credentials</span>
                <strong>Server-side only</strong>
              </div>
            </div>
            <p className="storage-config-note">
                Set <code className="code-label">PERMINISTER_SPACES_ACCESS_KEY</code>,{" "}
                <code className="code-label">PERMINISTER_SPACES_SECRET_KEY</code>, and a random{" "}
                <code className="code-label">PERMINISTER_IDENTITY_INDEX_SECRET</code> securely. Keep all
                three values server-side and out of public environment variables.
            </p>
          </section>

          <section className="guide-panel" aria-labelledby="recovery-title">
            <div className="guide-panel-head">
              <h2 id="recovery-title">Object layout and write boundary</h2>
              <p>
                The current JSON object is the source of truth. Activity objects record compact
                change metadata; they do not contain snapshots of current records.
              </p>
            </div>
            <div className="steps">
              <article className="step">
                <span className="step-number">01</span>
                <div>
                  <h3>Understand the multi-instance boundary</h3>
                  <p>
                    The mutation queue and organization locks run inside one app process. Multiple
                    Vercel instances can still race on uniqueness checks, role limits, invitations,
                    and updates because Spaces does not provide cross-object transactions or a
                    distributed lock.
                  </p>
                </div>
              </article>
              <article className="step">
                <span className="step-number">02</span>
                <div>
                  <h3>Enable recovery support</h3>
                  <p>
                    Enable Spaces object versioning and keep a separate backup before production
                    writes. Lookup and activity pointers can be rebuilt from canonical JSON objects.
                  </p>
                </div>
              </article>
              <article className="step">
                <span className="step-number">03</span>
                <div>
                  <h3>Inspect partial multi-record actions</h3>
                  <p>
                    Account registration and credential changes can span several objects. A failed
                    pointer write can affect listings even when the canonical record exists; use
                    the index rebuild command after reviewing the bucket.
                  </p>
                </div>
              </article>
              <article className="step">
                <span className="step-number">04</span>
                <div>
                  <h3>Run the v1 to v2 cutover</h3>
                  <p>
                    Pause app writes and back up the bucket. Run <code>npm run storage:migrate-v1-v2</code>
                    for a dry run, review the counts, then rerun with <code>-- --apply</code>. The
                    v1 prefix remains read-only after deployment.
                  </p>
                </div>
              </article>
            </div>
          </section>
        </div>

        <aside className="guide-aside" aria-label="Operational setup">
          <section className="aside-card">
            <span className="key-callout-icon">
              <LockIcon />
            </span>
            <h2>Required storage settings</h2>
            <ul className="secure-list">
              <li>
                <CheckIcon />
                <code>PERMINISTER_SPACES_ENDPOINT</code> = bucket HTTPS endpoint
              </li>
              <li>
                <CheckIcon />
                <code>PERMINISTER_SPACES_REGION</code> = sfo3
              </li>
              <li>
                <CheckIcon />
                <code>PERMINISTER_SPACES_BUCKET</code> = perminister
              </li>
              <li>
                <CheckIcon />
                Spaces access key and secret in server environment
              </li>
              <li>
                <CheckIcon />
                HMAC secret for the private email lookup index
              </li>
            </ul>
          </section>
          <section className="aside-card readiness-card">
            <h2>Four-read authorization</h2>
            <p>
              A bearer-key check reads the key, subject, organization, and product-member JSON
              directly. It does not list objects or replay historical events. Product membership
              is still separate from action grants.
            </p>
          </section>
          <section className="aside-card">
            <h2>Rebuild lookup pointers</h2>
            <p>
              Run <code>npm run storage:rebuild-v2-indexes</code> for a dry run. Add <code>-- --apply</code>
              after reviewing the count to rebuild HMAC email, subject, record, and activity indexes.
            </p>
          </section>
          <section className="aside-card">
            <h2>Optional email settings</h2>
            <p>
              Password recovery and verification require <code>RESEND_API_KEY</code>,{" "}
              <code>PERMINISTER_MAIL_FROM</code>, and <code>PERMINISTER_PUBLIC_ORIGIN</code>. Resend
              must accept the configured sender; missing configuration means no email is sent.
            </p>
          </section>
          <p className="health-note">
            <code className="code-label">GET /api/health</code> reports process liveness.{" "}
            <code className="code-label">GET /api/ready</code> checks Spaces access.{" "}
            <code className="code-label">GET /api/auth/session</code> reports the browser session.
            See <Link href="/developers/getting-started">setup details</Link>.
          </p>
        </aside>
      </div>
      <p className="guide-next-link">
        Return to the <Link href="/developers">developer guide overview</Link>.
      </p>
    </DeveloperGuideLayout>
  );
}
