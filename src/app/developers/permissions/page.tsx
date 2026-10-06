import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon } from "@/components/site-shell";

export default function PermissionsPage() {
  return (
    <DeveloperGuideLayout
      active="permissions"
      eyebrow="Developer guide / Permissions"
      title="Grant access in context"
      intro="Perminister grants are scoped to a consumer application and, where needed, to a resource owned by that application. The consumer app still enforces each decision on its server."
    >
      <div className="guide-grid">
        <div className="guide-main">
          <section className="guide-panel" aria-labelledby="scope-title">
            <div className="guide-panel-head">
              <h2 id="scope-title">Generic scope shapes</h2>
              <p>The current domain model supports these resource boundaries without a fixed application catalog.</p>
            </div>
            <table className="scope-table">
              <thead><tr><th scope="col">Scope kind</th><th scope="col">Identifier</th><th scope="col">Use</th></tr></thead>
              <tbody>
                <tr><td data-label="Scope kind">Product</td><td data-label="Identifier"><code className="code-label">productId</code></td><td data-label="Use">Grant actions across one consumer application's boundary.</td></tr>
                <tr><td data-label="Scope kind">Project</td><td data-label="Identifier"><code className="code-label">projectId</code></td><td data-label="Use">Limit actions to a project that the consumer app owns.</td></tr>
                <tr><td data-label="Scope kind">Workspace</td><td data-label="Identifier"><code className="code-label">workspaceId</code></td><td data-label="Use">Limit actions to a workspace that the consumer app owns.</td></tr>
              </tbody>
            </table>
          </section>

          <section className="guide-panel" aria-labelledby="enforcement-title">
            <div className="guide-panel-head">
              <h2 id="enforcement-title">Enforcement stays with the consumer</h2>
              <p>Perminister describes identity and grants; the consuming system knows its resources.</p>
            </div>
            <div className="steps">
              <article className="step"><span className="step-number">01</span><div><h3>Resolve the requested resource</h3><p>Load the project, workspace, or other resource through the consumer app's own data layer.</p></div></article>
              <article className="step"><span className="step-number">02</span><div><h3>Compare scope and actions</h3><p>Check that the identity or API key has a grant for the correct consumer and resource, with the action required by the request.</p></div></article>
              <article className="step"><span className="step-number">03</span><div><h3>Apply the decision server-side</h3><p>Do not rely on hidden UI controls as authorization. The consumer app enforces every protected operation against its own resource.</p></div></article>
            </div>
          </section>
        </div>

        <aside className="guide-aside" aria-label="Permission implementation notes">
          <section className="aside-card">
            <h2>Preserve legacy meaning</h2>
            <p>During migration, map fine-grained actions and platform-wide administrator semantics explicitly. Avoid flattening roles into a single broad grant.</p>
          </section>
          <section className="aside-card">
            <h2>Live permission queries are planned</h2>
            <p>No permission-query route or finalized response contract exists yet. Cache duration and behavior during a Perminister outage remain open decisions.</p>
            <ul className="secure-list">
              <li><CheckIcon />Use server-side resource checks.</li>
              <li><CheckIcon />Keep application data in its consumer system.</li>
            </ul>
          </section>
        </aside>
      </div>
      <p className="guide-next-link">Next: <Link href="/developers/api-keys">handle API keys safely</Link>.</p>
    </DeveloperGuideLayout>
  );
}
