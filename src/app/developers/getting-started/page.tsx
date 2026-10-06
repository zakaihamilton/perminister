import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import { CheckIcon } from "@/components/site-shell";

const steps = [
  {
    title: "Begin at the consumer application",
    body: "Keep the existing application portal as the place people start. The sign-in redirect and callback protocol is still planned.",
  },
  {
    title: "Confirm human identity through Perminister",
    body: "Perminister is intended to own shared identity and credential checks. Session boundaries and lifetimes are not finalized; each consumer app remains responsible for its own app session.",
  },
  {
    title: "Link legacy accounts explicitly",
    body: "Connect an existing project or workspace account only through a verified migration or account-linking flow. Matching emails do not automatically merge identities.",
  },
  {
    title: "Enforce access where the resource lives",
    body: "A consumer app uses a scoped identity or grant decision, then checks it on the server against its own project, workspace, or other domain resource.",
  },
];

export default function GettingStartedPage() {
  return (
    <DeveloperGuideLayout
      active="getting-started"
      eyebrow="Developer guide / Getting started"
      title="Integrate at the boundary"
      intro="Perminister centralizes identity checks. Each consumer application keeps its own portal, session, domain data, and authorization against those resources."
    >
      <div className="guide-grid">
        <section className="guide-panel" aria-labelledby="flow-title">
          <div className="guide-panel-head">
            <h2 id="flow-title">Planned integration flow</h2>
            <p>Use this sequence as product direction. No sign-in or account-linking endpoint is available yet.</p>
          </div>
          <div className="steps">
            {steps.map((step, index) => (
              <article className="step" key={step.title}>
                <span className="step-number">0{index + 1}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p></div>
              </article>
            ))}
          </div>
        </section>

        <aside className="guide-aside" aria-label="Integration decisions">
          <section className="aside-card">
            <h2>Keep ownership clear</h2>
            <ul className="secure-list">
              <li><CheckIcon />Perminister owns shared human identity and credentials.</li>
              <li><CheckIcon />Consumer apps own their portals and app sessions.</li>
              <li><CheckIcon />Consumer apps own domain data and resource enforcement.</li>
            </ul>
          </section>
          <section className="aside-card">
            <h2>Decisions still open</h2>
            <ul className="planned-list">
              <li>Sign-in redirect, callback, and session contract</li>
              <li>Verified proof for legacy account linking</li>
              <li>Session lifetime, logout, and deactivation behavior</li>
            </ul>
          </section>
        </aside>
      </div>
      <p className="guide-next-link">Next: <Link href="/developers/permissions">understand permission scopes</Link>.</p>
    </DeveloperGuideLayout>
  );
}
