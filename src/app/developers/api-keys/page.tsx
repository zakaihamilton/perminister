import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon, KeyIcon } from "@/components/site-shell";

const lifecycle = [
  { title: "Create with a narrow scope", body: "Associate a key with an owner, consumer/resource scope, and only the actions it needs." },
  { title: "Reveal the secret once", body: "The planned creation flow shows the raw secret only at creation. Perminister stores a SHA-256 verifier digest, not the plaintext key." },
  { title: "Rotate, expire, or revoke", body: "The domain record has lifecycle metadata for expiry, revocation, and rotation. User-facing lifecycle routes are still planned." },
];

export default function ApiKeysPage() {
  return (
    <DeveloperGuideLayout
      active="api-keys"
      eyebrow="Developer guide / API keys"
      title="Treat keys like credentials"
      intro="API keys are planned as scoped machine credentials, separate from human identity and consumer app sessions."
    >
      <div className="guide-grid">
        <section className="guide-panel" aria-labelledby="lifecycle-title">
          <div className="guide-panel-head">
            <h2 id="lifecycle-title">Planned key lifecycle</h2>
            <p>No key-creation, lookup, rotation, or revocation route exists yet.</p>
          </div>
          <div className="steps">
            {lifecycle.map((item, index) => (
              <article className="step" key={item.title}>
                <span className="step-number">0{index + 1}</span>
                <div><h3>{item.title}</h3><p>{item.body}</p></div>
              </article>
            ))}
          </div>
        </section>

        <aside className="guide-aside" aria-label="API key security guidance">
          <section className="aside-card key-callout">
            <span className="key-callout-icon"><KeyIcon /></span>
            <h2>Never place a secret in browser code</h2>
            <p>Consumer apps should use keys only from trusted server-side code. Keep them out of client bundles, source control, URLs, and logs.</p>
          </section>
          <section className="aside-card">
            <h2>Separate human and machine access</h2>
            <ul className="secure-list">
              <li><CheckIcon />Human users authenticate through the planned identity/session flow.</li>
              <li><CheckIcon />API keys represent service or user-owned machine credentials.</li>
              <li><CheckIcon />Both access paths need explicit scope and action checks.</li>
            </ul>
          </section>
        </aside>
      </div>
      <p className="guide-next-link">Next: <Link href="/developers/storage">review storage and readiness</Link>.</p>
    </DeveloperGuideLayout>
  );
}
