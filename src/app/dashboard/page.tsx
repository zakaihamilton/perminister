import {
  KeyIcon,
  LayersIcon,
  LockIcon,
  SiteFooter,
  SiteHeader,
} from "@/components/site-shell";

const permissionScopes = [
  {
    name: "Product scope",
    detail: "Grant actions within one consumer application.",
  },
  {
    name: "Project scope",
    detail: "Attach actions to a project owned by a consumer application.",
  },
  {
    name: "Workspace scope",
    detail: "Attach actions to a workspace owned by a consumer application.",
  },
];

function UserIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.4 3.2-5 7-5s6.2 1.6 7 5" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m12 3 9 16H3l9-16Z" />
      <path d="M12 9v4m0 3h.01" />
    </svg>
  );
}

export default function DashboardPage() {
  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="page-shell">
        <div className="container dashboard-page">
          <div className="page-heading-row">
            <div>
              <p className="eyebrow">Workspace</p>
              <h1>Dashboard</h1>
              <p className="page-intro">A central place for identity, product memberships, permissions, and API keys.</p>
            </div>
            <span className="preview-badge"><WarningIcon /> Preview · no session</span>
          </div>

          <section className="dashboard-callout" aria-label="Dashboard availability">
            <span className="callout-icon"><WarningIcon /></span>
            <div>
              <strong>No authenticated session is available in this preview.</strong>
              <p>Sign-in, account creation, and legacy-account linking routes are not implemented, so Authodox is not loading or changing account data here.</p>
            </div>
          </section>

          <div className="dashboard-grid">
            <section className="panel" aria-labelledby="account-title">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title" id="account-title">Central identity</h2>
                  <p className="panel-subtitle">Your Authodox account and explicitly linked consumer accounts</p>
                </div>
                <span className="subtle-label">Not loaded</span>
              </div>
              <div className="account-empty">
                <span className="avatar-placeholder"><UserIcon /></span>
                <div className="account-copy">
                  <strong>No account selected</strong>
                  <p>Sign in to view an identity. Existing product accounts will require an explicit linking flow.</p>
                </div>
                <div className="account-actions">
                  <button className="small-button" type="button" disabled aria-disabled="true">Create identity</button>
                  <button className="small-button" type="button" disabled aria-disabled="true">Link existing account</button>
                </div>
              </div>
              <div className="account-foot">
                <LockIcon />
                Matching email addresses do not automatically merge legacy accounts.
              </div>
            </section>

            <section className="panel summary-panel" aria-labelledby="status-title">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title" id="status-title">Connection status</h2>
                  <p className="panel-subtitle">No backend account data is being queried</p>
                </div>
              </div>
              <div className="summary-body">
                <div className="summary-status"><span />No authenticated session</div>
                <div className="summary-metric"><span>Identity session</span><strong>Unavailable</strong></div>
                <div className="summary-metric"><span>Connected-app data</span><strong>Not loaded</strong></div>
                <div className="summary-metric"><span>Spaces readiness</span><strong>Not checked</strong></div>
                <p className="summary-note">The health route reports process liveness only; it does not check Spaces.</p>
              </div>
            </section>
          </div>

          <section className="panel dashboard-section" aria-labelledby="access-title">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="access-title">Permissions &amp; resource scopes</h2>
                <p className="panel-subtitle">Supported scope shapes · no memberships or connected-app data are loaded</p>
              </div>
              <span className="subtle-label">Planned model</span>
            </div>
            <div className="product-access-grid">
              {permissionScopes.map((scope) => (
                <article className="access-card" key={scope.name}>
                  <div className="access-card-head">
                    <span className="access-card-name">{scope.name}</span>
                    <span className="planned-tag">Planned</span>
                  </div>
                  <p>{scope.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="dashboard-bottom-grid">
            <section className="panel" aria-labelledby="keys-title">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title" id="keys-title">API keys</h2>
                  <p className="panel-subtitle">Scoped credentials for server-to-server use</p>
                </div>
              </div>
              <div className="empty-feature">
                <span className="empty-feature-icon"><KeyIcon /></span>
                <div>
                  <h3>Key management is not available yet</h3>
                  <p>Creation, rotation, expiry, and revocation flows have not been built. No key list is being shown.</p>
                  <button className="small-button" type="button" disabled aria-disabled="true">Create API key</button>
                  <p className="fine-print">Planned storage keeps only a one-way verifier; a raw secret would be shown only at creation.</p>
                </div>
              </div>
            </section>

            <section className="panel" aria-labelledby="activity-title">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title" id="activity-title">Recent activity</h2>
                  <p className="panel-subtitle">Identity and permission changes</p>
                </div>
              </div>
              <div className="empty-feature">
                <span className="empty-feature-icon"><LayersIcon /></span>
                <div>
                  <h3>No activity feed yet</h3>
                  <p>The storage adapter has event-object support, but event recovery and a product-facing activity view are not implemented.</p>
                  <p className="fine-print">Nothing has been written by this dashboard.</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
