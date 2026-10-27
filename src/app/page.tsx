import Link from "next/link";
import { ArrowRight, SiteFooter, SiteHeader } from "@/components/site-shell";
import { WelcomeAccessIllustration } from "@/components/welcome-access-illustration";

const capabilities = [
  {
    label: "Organization catalog",
    title: "Keep every product in view",
    text: "Manage organization and product details from one shared workspace.",
  },
  {
    label: "Product teams",
    title: "Make ownership clear",
    text: "Product Owners and Admins manage membership, invitations, and permission grants.",
  },
  {
    label: "Scoped permissions",
    title: "Define the actions people need",
    text: "Grant product, project, or workspace actions, then check them from your server with a scoped API key.",
  },
];

const accessLevels = [
  {
    number: "01",
    title: "Organization",
    text: "Owners and Admins manage organization and product details in the catalog.",
  },
  {
    number: "02",
    title: "Product",
    text: "Product Owners and Admins manage their team, invitations, and explicit grants.",
  },
  {
    number: "03",
    title: "Permission",
    text: "An active grant is required for an action. Product membership alone does not authorize it.",
  },
];

export default function HomePage() {
  return (
    <div className="home-page">
      <SiteHeader active="home" />
      <main className="page-shell home-page-main">
        <section className="container welcome-hero" aria-labelledby="home-title">
          <div className="welcome-hero-copy">
            <p className="eyebrow">For organization owners and admins</p>
            <h1 id="home-title">Manage product access across your organization.</h1>
            <p className="welcome-hero-lede">
              Invite people to product teams, grant specific actions, and manage access across your
              organization from one workspace.
            </p>
            <div className="hero-actions welcome-hero-actions">
              <Link className="button button-primary" href="/register">
                Create an account <ArrowRight />
              </Link>
              <Link className="button button-secondary" href="/developers">
                Explore the developer guide
              </Link>
            </div>
          </div>

          <figure className="welcome-hero-figure">
            <WelcomeAccessIllustration />
          </figure>
        </section>

        <section className="container home-benefits" aria-labelledby="home-benefits-title">
          <header className="home-section-heading">
            <p className="eyebrow">Manage access together</p>
            <h2 id="home-benefits-title">Organize products and give teams the access they need.</h2>
            <p>
              Organization Owners and Admins manage organization and product details. Product teams
              handle collaboration, while explicit grants define the actions a member can take.
            </p>
          </header>
          <div className="home-benefit-grid">
            {capabilities.map((capability) => (
              <article className="home-benefit-card" key={capability.label}>
                <p className="home-card-label">{capability.label}</p>
                <h3>{capability.title}</h3>
                <p>{capability.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container home-access-section" aria-labelledby="home-access-title">
          <header className="home-section-heading home-access-heading">
            <p className="eyebrow">How access works</p>
            <h2 id="home-access-title">Manage access at each level.</h2>
            <p>
              Perminister centralizes identity and permission records. Each product keeps its own
              sessions, domain data, and final resource checks.
            </p>
          </header>
          <div className="home-access-grid">
            {accessLevels.map((level) => (
              <article className="home-access-card" key={level.number}>
                <span className="home-access-number">{level.number}</span>
                <h3>{level.title}</h3>
                <p>{level.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container home-closing-cta" aria-labelledby="home-cta-title">
          <div>
            <p className="home-cta-label">Start with your organization</p>
            <h2 id="home-cta-title">Get started with your organization.</h2>
            <p>
              Request or manage your organization workspace and bring products, teams, and access
              together.
            </p>
          </div>
          <Link className="button home-closing-button" href="/dashboard">
            Open dashboard <ArrowRight />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
