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
    title: "Grant access and create a key",
    body: "A Product Owner or Admin grants product/project/workspace actions to an active product member. Product roles do not grant API actions by themselves. Members create their own keys from explicit grants and see each secret only once.",
  },
  {
    title: "Authorize each server-side resource operation",
    body: "Call POST /api/authorize from trusted server code with the bearer key, organization ID, scope IDs, and action. The consumer application still loads and enforces access against its own resource.",
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
              Request an organization, wait for approval, add a product, then give members the
              access they need.
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
