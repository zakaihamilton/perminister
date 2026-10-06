import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon } from "@/components/site-shell";

const steps = [
  {
    title: "Configure private storage and an administrator",
    body: "Set the Spaces endpoint, bucket, region, access key, and secret. Add an account email to PERMINISTER_ADMIN_EMAILS, then register with that address to manage identities and grants.",
  },
  {
    title: "Create a central identity",
    body: "Use the registration page to create an email/password account. Perminister stores a salted scrypt verifier and stable subject ID. Existing application accounts are never merged automatically.",
  },
  {
    title: "Create a scoped permission grant and API key",
    body: "An administrator grants generic product/project/workspace actions. Each account creates a key limited to its own grants and sees its raw secret only once.",
  },
  {
    title: "Authorize each server-side resource operation",
    body: "Call POST /api/authorize from trusted server code with the bearer key, scope IDs, and action. The consumer application still loads and enforces access against its own resource.",
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
            <p>Configure storage before registration; create an administrator before assigning grants.</p>
          </div>
          <div className="steps">
            {steps.map((step, index) => (
              <article className="step" key={step.title}>
                <span className="step-number">0{index + 1}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p></div>
              </article>
            ))}
          </div>
          <p className="storage-config-note">See the <Link href="/dashboard">dashboard</Link> to create accounts and keys, and the <Link href="/developers/api-keys">API-key guide</Link> for the authorization payload.</p>
        </section>

        <aside className="guide-aside" aria-label="Integration configuration">
          <section className="aside-card">
            <h2>Keep ownership clear</h2>
            <ul className="secure-list">
              <li><CheckIcon />Perminister owns shared human identity and credentials.</li>
              <li><CheckIcon />Consumer apps own their branded portals and app sessions.</li>
              <li><CheckIcon />Consumer apps own domain data and final resource enforcement.</li>
            </ul>
          </section>
          <section className="aside-card">
            <h2>Resend setup is optional</h2>
            <p>Sign-in works without email delivery. Verification and password recovery require a Resend API key, an accepted sender address, and the public application origin; the UI never claims a message was sent when Resend rejects it.</p>
          </section>
          <section className="aside-card">
            <h2>Account linking is not available</h2>
            <p>Legacy accounts are not merged by matching email. A future migration must authenticate or otherwise verify both identities explicitly.</p>
          </section>
        </aside>
      </div>
      <p className="guide-next-link">Next: <Link href="/developers/permissions">understand permission scopes</Link>.</p>
    </DeveloperGuideLayout>
  );
}
