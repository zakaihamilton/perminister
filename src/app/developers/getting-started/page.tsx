import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon } from "@/components/site-shell";
import { withCanonical } from "@/lib/site-metadata";

export const metadata = withCanonical(
  {
    title: "Getting started",
    description:
      "Set up a Perminister organization, add a product, grant access, and make server-side authorization checks.",
  },
  "/developers/getting-started",
);

const steps = [
  {
    title: "Request an organization",
    body: "Register and verify your account, then submit an organization request. A platform administrator must approve it before the workspace becomes available; you become its Owner after approval.",
  },
  {
    title: "Add a product",
    body: "Owners and Admins can enter a website URL, then edit the suggested product name, ID, description, website, and icon before saving.",
  },
  {
    title: "Connect the consumer app",
    body: "Configure one server-side client ID and secret for the app, bound to its stable product ID. The app backend calls Perminister for identity and organization access, then keeps the app's own session and data. The same product ID can be added under several organizations; their people and grants remain separate.",
  },
  {
    title: "Invite people and assign access",
    body: "A Product Owner or Admin invites people and creates reusable access roles in the product's Access page. Each role bundles exact action names the app checks; the role can then be assigned at product, project, or workspace scope. Product membership roles do not grant app permissions by themselves.",
  },
  {
    title: "Authorize app requests",
    body: "The app backend keeps the Perminister consumer session in its own HttpOnly cookie and can check a person's organization, resource, and action with POST /api/authorize. For background integrations such as telemetry writers, use a separate service principal and a narrowly scoped API key.",
  },
];

export default function GettingStartedPage() {
  return (
    <DeveloperGuideLayout
      active="getting-started"
      eyebrow="Developer guide / Getting started"
      title="Integrate at the boundary"
      intro="Perminister manages central identity and access. Consumer applications keep their own portals, sessions, data, and resource enforcement."
    >
      <div className="guide-grid">
        <section className="guide-panel" aria-labelledby="flow-title">
          <div className="guide-panel-head">
            <h2 id="flow-title">First integration flow</h2>
            <p>
              Request an organization, add the app once, then invite people and assign scoped
              access.
            </p>
          </div>
          <div className="steps">
            {steps.map((step, index) => (
              <article className="step" key={step.title}>
                <span className="step-number">0{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="storage-config-note">
            See the <Link href="/dashboard">dashboard</Link> to request organizations and create
            keys, and the <Link href="/developers/api-keys">API-key guide</Link> for the
            authorization payload.
          </p>
        </section>

        <aside className="guide-aside" aria-label="Integration configuration">
          <section className="aside-card">
            <h2>Keep ownership clear</h2>
            <ul className="secure-list">
              <li>
                <CheckIcon />
                Perminister owns shared human identity and credentials.
              </li>
              <li>
                <CheckIcon />
                Consumer apps own their branded portals and app sessions.
              </li>
              <li>
                <CheckIcon />
                Consumer apps own domain data and final resource enforcement.
              </li>
            </ul>
          </section>
          <section className="aside-card">
            <h2>Platform-wide email delivery</h2>
            <p>
              Configure Resend once for Perminister; organizations use the shared email service and
              do not configure Resend separately. Email verification, password recovery, and
              invitations require the platform configuration. Sign-in itself works without email
              delivery.
            </p>
          </section>
        </aside>
      </div>
      <p className="guide-next-link">
        Next: <Link href="/developers/permissions">understand permission scopes</Link>.
      </p>
    </DeveloperGuideLayout>
  );
}
