import Link from "next/link";
import { ArrowRight, SiteFooter, SiteHeader } from "@/components/site-shell";

const steps = [
  { number: "01", title: "Create your organization", text: "Set up a shared space for the products and people you manage." },
  { number: "02", title: "Add a product", text: "Start with a website or product name, review its details, and save." },
  { number: "03", title: "Give the right access", text: "Invite teammates, grant product actions, and create scoped API keys." },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader active="home" />
      <main className="page-shell home-simple">
        <section className="container simple-hero">
          <div className="simple-hero-copy">
            <p className="eyebrow">Identity and access, made manageable</p>
            <h1>Manage your products and the people who use them.</h1>
            <p>Perminister gives each organization one clear place to manage products, team access, and API keys. Your dashboard keeps each task on its own page.</p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/register">Get started <ArrowRight /></Link>
              <Link className="button button-secondary" href="/developers">For developers</Link>
            </div>
          </div>
          <div className="simple-hero-panel" aria-label="Organization dashboard sections">
            <p className="eyebrow">Your organization</p>
            <strong>Acme Studio</strong>
            <div className="simple-panel-links"><span>Products</span><span>People</span><span>Access</span><span>API keys</span></div>
            <p>One sidebar. A dedicated page for every task.</p>
          </div>
        </section>
        <section className="container simple-steps-section">
          <header><p className="eyebrow">A simple setup</p><h2>From account to product access</h2></header>
          <div className="simple-steps">{steps.map((step) => <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
        </section>
        <section className="container home-bottom-cta simple-cta">
          <div><h2>Join your team or create a workspace.</h2><p>Members can manage their own profile, sessions, and API keys. Owners and admins manage products and access.</p></div>
          <Link className="button button-primary" href="/dashboard">Open dashboard <ArrowRight /></Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
