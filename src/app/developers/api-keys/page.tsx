import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon, KeyIcon } from "@/components/site-shell";

const lifecycle = [
  { title: "Create with a narrow scope", body: "Choose product, project, or workspace scope, only the actions needed, and an expiration. The effective authorization is limited by the account's active grants too." },
  { title: "Copy the secret once", body: "The dashboard returns a random bearer key in the creation response. Spaces stores only its SHA-256 verifier; refresh the page and the raw key is gone." },
  { title: "Rotate, expire, or revoke", body: "Create a replacement with the same scope, then revoke the prior key. Expired and revoked keys fail authorization on the next check." },
];

export default function ApiKeysPage() {
  return (
    <DeveloperGuideLayout
      active="api-keys"
      eyebrow="Developer guide / API keys"
      title="Treat keys like credentials"
      intro="Perminister API keys are server-only machine credentials, separate from human browser sessions and consumer-app sessions."
    >
      <div className="guide-grid">
        <section className="guide-panel" aria-labelledby="lifecycle-title">
          <div className="guide-panel-head">
            <h2 id="lifecycle-title">Key lifecycle</h2>
            <p>Create and manage keys from the signed-in dashboard.</p>
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
            <h2>Keep keys on trusted servers</h2>
            <p>Consumer apps should send keys only from trusted server-side code. Keep them out of browser bundles, source control, URLs, client storage, and logs.</p>
          </section>
          <section className="aside-card">
            <h2>Authorization request</h2>
            <pre className="code-block"><code>{`POST /api/authorize
Authorization: Bearer pmk_<uuid>_<secret>
Content-Type: application/json

{
  "productId": "product-id",
  "resourceKind": "project",
  "resourceId": "project-id",
  "action": "read:profile"
}`}</code></pre>
            <p>See <Link href="/developers/permissions">permission scopes</Link> for evaluation rules and <Link href="/dashboard">the dashboard</Link> to create a key.</p>
          </section>
          <section className="aside-card">
            <h2>Separate human and machine access</h2>
            <ul className="secure-list">
              <li><CheckIcon />Human users sign in through the Perminister browser session.</li>
              <li><CheckIcon />Consumer applications keep their own app sessions.</li>
              <li><CheckIcon />Server keys require explicit scope and action checks.</li>
            </ul>
          </section>
        </aside>
      </div>
      <p className="guide-next-link">Next: <Link href="/developers/storage">review storage and readiness</Link>.</p>
    </DeveloperGuideLayout>
  );
}
