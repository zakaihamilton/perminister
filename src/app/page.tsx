import {
  ArrowRight,
  ArrowUpRight,
  Brand,
  CheckIcon,
  KeyIcon,
  LayersIcon,
  LockIcon,
  SiteFooter,
  SiteHeader,
} from "@/components/site-shell";

function PersonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.4 3.2-5 7-5s6.2 1.6 7 5" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <>
      <SiteHeader active="home" />
      <main className="page-shell">
        <section className="container home-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="hero-kicker"><span className="kicker-spark" />Identity infrastructure for your products</p>
            <h1 id="hero-title">One identity layer.<br /><em>Every product.</em></h1>
            <p className="hero-lede">
              Perminister brings shared identity, product-scoped permissions, and API-key lifecycle into one service—while each app keeps its own portal and its own data.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/dashboard">Explore the dashboard <ArrowRight /></a>
              <a className="button button-secondary" href="/developers">Developer guide <ArrowUpRight /></a>
            </div>
            <p className="hero-footnote">An early product preview · Account and integration flows are not connected yet</p>
          </div>

          <div className="hero-visual" role="group" aria-label="Conceptual identity and access flow">
            <div className="visual-orbit" aria-hidden="true" />
            <div className="visual-glow" aria-hidden="true" />
            <div className="architecture-card">
              <div className="architecture-top">
                <div>
                  <p className="eyebrow">One shared service</p>
                  <h2>A common identity layer</h2>
                </div>
                <span className="preview-tag">Concept</span>
              </div>
              <div className="architecture-content">
                <div className="identity-source">
                  <span className="identity-source-icon"><PersonIcon /></span>
                  <div className="identity-source-copy">
                    <strong>Person / account</strong>
                    <span>Starts from a consumer app</span>
                  </div>
                </div>
                <p className="flow-label">Identity and credential check</p>
                <div className="flow-stem" aria-hidden="true" />
                <div className="perminister-service-group">
                  <div className="perminister-node">
                    <Brand compact />
                    <div className="node-copy">
                      <strong>Identity and access service</strong>
                      <span>Centralized by Perminister</span>
                    </div>
                  </div>
                  <div className="service-capabilities" aria-label="Perminister capabilities">
                    <span>Identity &amp; credentials</span>
                    <span>Human session checks</span>
                    <span>Scoped permissions</span>
                    <span>API keys</span>
                  </div>
                </div>
                <p className="flow-label">Scoped identity and access decisions</p>
                <div className="flow-stem" aria-hidden="true" />
                <div className="consumer-applications" role="group" aria-label="Illustrative consumer applications, not live connections">
                  <div className="consumer-applications-head">
                    <strong>Consumer applications</strong>
                    <span className="preview-tag">Conceptual</span>
                  </div>
                  <div className="consumer-app-grid">
                    <div className="consumer-app-card"><LayersIcon /><strong>Consumer app</strong></div>
                    <div className="consumer-app-card"><LayersIcon /><strong>Consumer app</strong></div>
                    <div className="consumer-app-card"><LayersIcon /><strong>Consumer app</strong></div>
                  </div>
                  <p>Each keeps its own portal, app session, domain data, and resource enforcement.</p>
                </div>
                <p className="flow-caption">Conceptual boundary · no live app connection</p>
              </div>
            </div>
            <div className="visual-note">
              <span className="visual-note-mark"><LockIcon /></span>
              <p><strong>Private by design</strong>Spaces credentials stay on the server. Product apps never access the bucket.</p>
            </div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Perminister integration boundary">
          <div className="container trust-strip-inner">
            <span className="trust-label">Clear boundary</span>
            <p className="trust-copy">Perminister provides identity and grants; each consumer app keeps its portal, session, data, and resource enforcement.</p>
            <span className="trust-caption">No connected-app data is loaded</span>
          </div>
        </section>

        <section className="container section-block" aria-labelledby="approach-title">
          <div className="section-heading">
            <p className="eyebrow">A shared foundation</p>
            <h2 id="approach-title">One identity. Clear boundaries.</h2>
              <p>Give consumer applications a consistent way to identify people and request scoped access, without moving their domain data into Perminister.</p>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-icon"><LockIcon /></span>
              <h3>Identity with intent</h3>
              <p>Stable global identities can connect legacy accounts through an explicit, verified linking flow—not an email match.</p>
            </article>
            <article className="feature-card">
              <span className="feature-icon"><LayersIcon /></span>
              <h3>Access in context</h3>
              <p>Grants carry a product and resource scope. Each app continues to enforce access against its own projects or workspaces.</p>
            </article>
            <article className="feature-card">
              <span className="feature-icon"><KeyIcon /></span>
              <h3>Keys with a lifecycle</h3>
              <p>Scoped machine credentials are designed for rotation and revocation, with only a one-way verifier stored in Perminister.</p>
            </article>
          </div>
        </section>

        <section className="container" aria-labelledby="boundary-title">
          <div className="principle-panel">
            <div>
              <p className="eyebrow">Built around your app</p>
              <h2 id="boundary-title">Shared identity.<br />Product-owned access.</h2>
            </div>
            <div className="principle-copy">
              <p>Perminister is a standalone identity and permission service. Each consumer application remains the place people start and the system that understands its own data.</p>
              <ul className="principle-list">
                <li><CheckIcon />Portals stay familiar to users</li>
                <li><CheckIcon />App data and resource checks stay in each product</li>
                <li><CheckIcon />Spaces is the only planned persistence layer</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="container home-bottom-cta" aria-labelledby="next-title">
          <div>
            <h2 id="next-title">See what’s ready—and what isn’t.</h2>
            <p>The dashboard and developer guide distinguish current foundation from planned flows.</p>
          </div>
          <a className="button" href="/developers">Read the developer guide <ArrowRight /></a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
