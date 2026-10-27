import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon } from "@/components/site-shell";
import { withCanonical } from "@/lib/site-metadata";

export const metadata = withCanonical(
  {
    title: "Getting started",
    description: "Connect an application backend to Perminister authentication and authorization.",
  },
  "/developers/getting-started",
);

const steps = [
  {
    title: "Set up the product in Perminister",
    body: "Set up the product in the organization that publishes the app. Keep its product ID stable; organizations that install the public product share its app client configuration while keeping their own members and grants.",
  },
  {
    title: "Connect the app backend",
    body: "A product owner or admin creates an app client from the publisher product’s App clients page and sets its app origin. Set http://localhost without a port to allow the app to run on any localhost port during development; add a port to restrict sign-in to that port. Other app origins must match exactly. Reuse that client across organizations installing the public product. Copy the client ID and one-time secret into the app backend. The backend sends them in X-Perminister-Client-Id and X-Perminister-Client-Secret headers; never include the secret in browser code or logs.",
  },
  {
    title: "Keep the app's own session",
    body: "The backend can use password login or the Sign in with Perminister authorization-code flow. Store the returned session token in your app's Secure, HttpOnly, SameSite cookie and keep it out of browser JavaScript. The token is bound to that app.",
  },
  {
    title: "Select an organization and grant access",
    body: "Use the organizations and grants returned for the signed-in account. Each authorization request includes the organization, product, resource, and exact action; product membership alone does not grant an action.",
  },
  {
    title: "Authorize protected requests",
    body: "Call POST /api/authorize from the backend before serving a protected operation. Load the app's own resource and enforce the decision there. For background work, use a service principal with a narrowly scoped service key.",
  },
];

export default function GettingStartedPage() {
  return (
    <DeveloperGuideLayout
      active="getting-started"
      eyebrow="Developer guide / Getting started"
      title="Connect your app to Perminister"
      intro="Perminister manages central identity and access. Consumer applications keep their own portals, sessions, data, and resource enforcement."
    >
      <div className="guide-grid">
        <section className="guide-panel" aria-labelledby="flow-title">
          <div className="guide-panel-head">
            <h2 id="flow-title">App integration flow</h2>
            <p>
              Keep identity shared, sessions app-specific, and resource authorization on the app
              backend.
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
            See the <Link href="/developers/api-keys">API-key guide</Link> for the authorization
            request and the <Link href="/developers/permissions">permissions guide</Link> for scope
            rules. Read the{" "}
            <a href="https://github.com/zakaihamilton/perminister/blob/main/docs/api.md">
              full application API contract
            </a>{" "}
            for endpoint details.
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
            <h2>Example: check access</h2>
            <p>From your backend, use a scoped API key to check an action before serving it.</p>
            <pre className="code-block">
              <code>{`const response = await fetch(
  PERMINISTER_URL + "/api/authorize",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + PERMINISTER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      organizationId: "YOUR_ORG_ID",
      productId: "YOUR_PRODUCT_ID",
      resourceKind: "project",
      resourceId: "YOUR_PROJECT_ID",
      action: "read:profile",
    }),
    signal: AbortSignal.timeout(5000),
  },
);

if (response.status !== 200 ||
    (await response.json()).authorized !== true) {
  throw new Error("Access denied");
}
// Serve the protected action only after this check.`}</code>
            </pre>
            <p>
              Replace the example IDs and action with the grant you want to check. Deny access on
              every other response, invalid response, network error, or timeout. Load the resource
              and verify its organization boundary in your app before serving it.
            </p>
          </section>
          <section className="aside-card">
            <h2>Verification and recovery</h2>
            <p>
              Consumer endpoints can request email verification and password recovery. Your app can
              provide branded completion pages; email delivery and link routing are configured by
              the Perminister platform operator.
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
