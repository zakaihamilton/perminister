import Image from "next/image";
import Link from "next/link";
import { ArrowRight, SiteFooter, SiteHeader } from "@/components/site-shell";

const capabilities = [
  {
    number: "01",
    title: "Keep products together",
    text: "Give each organization a clear catalog of the products its team manages.",
  },
  {
    number: "02",
    title: "Assign access by scope",
    text: "Grant product, project, or workspace actions to the right people.",
  },
  {
    number: "03",
    title: "Use keys on the server",
    text: "Create scoped API keys for server-to-server authorization checks.",
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader active="home" />
      <main className="page-shell home-simple">
        <section className="container landing-hero">
          <div className="landing-copy">
            <p className="eyebrow">Organization access management</p>
            <h1>Know who can use what.</h1>
            <p className="landing-lede">
              Manage products, team access, and API keys from one organization workspace. Keep
              permissions scoped to the work people need to do.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/register">
                Create an account <ArrowRight />
              </Link>
              <Link className="button button-secondary" href="/developers">
                Read the developer guide
              </Link>
            </div>
            <p className="landing-note">
              Consumer applications keep their own sessions, data, and resource checks.
            </p>
          </div>
          <figure className="landing-figure">
            <Image
              alt="Team identities connect through a shared key to separate product resources."
              className="landing-illustration"
              height={887}
              priority
              sizes="(max-width: 740px) 100vw, 52vw"
              src="/illustrations/identity-access-map.png"
              width={1774}
            />
            <figcaption>
              <span>People</span>
              <span>Identity</span>
              <span>Product access</span>
            </figcaption>
          </figure>
        </section>

        <section className="container capability-section" aria-labelledby="capabilities-title">
          <header className="section-heading">
            <p className="eyebrow">A clear operating model</p>
            <h2 id="capabilities-title">Access has a place and a purpose.</h2>
            <p>
              Perminister centralizes identity and permission records while each product remains
              responsible for its own domain data and final resource checks.
            </p>
          </header>
          <div className="capability-list">
            {capabilities.map((item) => (
              <article className="capability-row" key={item.number}>
                <span className="capability-number">{item.number}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container home-bottom-cta simple-cta">
          <div>
            <p className="eyebrow">Start with your team</p>
            <h2>Set up an organization workspace.</h2>
            <p>
              Owners and admins manage products and invitations. Members can review their own
              access, profile, sessions, and API keys.
            </p>
          </div>
          <Link className="button button-primary" href="/dashboard">
            Open dashboard <ArrowRight />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
