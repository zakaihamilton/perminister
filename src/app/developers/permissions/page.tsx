import Link from "next/link";
import { Tooltip } from "@/components/tooltip";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon } from "@/components/site-shell";

export default function PermissionsPage() {
  return (
    <DeveloperGuideLayout
      active="permissions"
      eyebrow="Developer guide / Permissions"
      title="Grant access in context"
      intro="Perminister grants are scoped to an organization and one of its products, then optionally to a project or workspace. The consumer app still enforces each decision on its server."
    >
      <div className="guide-grid">
        <div className="guide-main">
          <section className="guide-panel" aria-labelledby="scope-title">
            <div className="guide-panel-head">
              <h2 id="scope-title">
                Generic scope shapes{" "}
                <Tooltip content="Product scope applies across its resources. Project and workspace scopes narrow a grant to one resource identifier." />
              </h2>
              <p>
                Organization Owners and Admins create grants in the dashboard. Product IDs belong to
                an organization; project/workspace IDs and actions are supplied by each consumer
                application.
              </p>
            </div>
            <table className="scope-table">
              <thead>
                <tr>
                  <th scope="col">Scope part</th>
                  <th scope="col">Identifier</th>
                  <th scope="col">Use</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Scope part">Organization</td>
                  <td data-label="Identifier">
                    <code className="code-label">organizationId</code>
                  </td>
                  <td data-label="Use">
                    Required customer boundary on every grant and authorization request.
                  </td>
                </tr>
                <tr>
                  <td data-label="Scope part">Product</td>
                  <td data-label="Identifier">
                    <code className="code-label">productId</code>
                  </td>
                  <td data-label="Use">Grant actions across one product in that organization.</td>
                </tr>
                <tr>
                  <td data-label="Scope part">Project</td>
                  <td data-label="Identifier">
                    <code className="code-label">projectId</code>
                  </td>
                  <td data-label="Use">Limit actions to a project that the consumer app owns.</td>
                </tr>
                <tr>
                  <td data-label="Scope part">Workspace</td>
                  <td data-label="Identifier">
                    <code className="code-label">workspaceId</code>
                  </td>
                  <td data-label="Use">Limit actions to a workspace that the consumer app owns.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="guide-panel" aria-labelledby="enforcement-title">
            <div className="guide-panel-head">
              <h2 id="enforcement-title">Enforcement stays with the consumer</h2>
              <p>
                <code className="code-label">POST /api/authorize</code> checks the organization,
                product, resource, action, membership, bearer key, and current grants. The consumer
                application still loads and enforces access against its own resource.
              </p>
            </div>
            <div className="steps">
              <article className="step">
                <span className="step-number">01</span>
                <div>
                  <h3>Resolve the requested resource</h3>
                  <p>
                    Load the project, workspace, or other resource through the consumer app&apos;s
                    own data layer.
                  </p>
                </div>
              </article>
              <article className="step">
                <span className="step-number">02</span>
                <div>
                  <h3>Compare scope and actions</h3>
                  <p>
                    Check that the identity or API key has a grant for the correct consumer and
                    resource, with the action required by the request.
                  </p>
                </div>
              </article>
              <article className="step">
                <span className="step-number">03</span>
                <div>
                  <h3>Apply the decision server-side</h3>
                  <p>
                    Do not rely on hidden UI controls as authorization. The consumer app enforces
                    every protected operation against its own resource.
                  </p>
                </div>
              </article>
            </div>
          </section>
        </div>

        <aside className="guide-aside" aria-label="Permission guidance">
          <section className="aside-card">
            <h2>Use current grants</h2>
            <p>
              Perminister evaluates the current key and grant state for each authorization request.
              If your application caches decisions, choose an expiration that fits your access
              revocation needs.
            </p>
            <ul className="secure-list">
              <li>
                <CheckIcon />
                Use server-side resource checks.
              </li>
              <li>
                <CheckIcon />
                Keep application data in its consumer system.
              </li>
            </ul>
          </section>
        </aside>
      </div>
      <p className="guide-next-link">
        Next: <Link href="/developers/api-keys">handle API keys safely</Link>.
      </p>
    </DeveloperGuideLayout>
  );
}
