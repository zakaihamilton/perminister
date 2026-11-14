import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./consumer-auth-presentation.module.css";

export type ConsumerAuthPresentation = {
  brand: ReactNode;
  aside: ReactNode;
  footer?: ReactNode;
};

function PostParticlePresentation(): ConsumerAuthPresentation {
  return {
    brand: (
      <div className={styles.brand}>
        <span className={styles.postMark} aria-hidden="true">
          <svg width="31" height="33" viewBox="0 0 31 33" fill="none">
            <path
              d="M10 27V12h6a5 5 0 0 1 0 10h-6"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="24" cy="7" r="2.5" fill="currentColor" opacity=".7" />
          </svg>
        </span>
        <span>postparticle</span>
      </div>
    ),
    aside: (
      <section className={styles.story}>
        <p className={styles.eyebrow}>THE EDITORIAL WORKSPACE</p>
        <h1>Make room for your next story.</h1>
        <p>Write, organize, and publish. Everything your team needs, in one place.</p>
        <Image
          className={styles.storyImage}
          src="/auth-brands/postparticle.webp"
          width={1536}
          height={1024}
          sizes="(max-width: 800px) 100vw, 50vw"
          priority
          alt="Paper proofs and books on a sunlit publishing desk"
        />
      </section>
    ),
    footer: <span>Your drafts stay private until you publish.</span>,
  };
}

function VisitoringPresentation(): ConsumerAuthPresentation {
  return {
    brand: (
      <div className={styles.brand}>
        <Image src="/auth-brands/visitoring.svg" width={28} height={28} alt="" />
        <span>Visitoring</span>
      </div>
    ),
    aside: (
      <section className={styles.visitoring}>
        <p className={styles.eyebrow}>PRIVATE WEBSITE ANALYTICS</p>
        <h1>
          Know your traffic.
          <br />
          <em>Keep it simple.</em>
        </h1>
        <p>Private analytics for the sites you run, with no public sign-up.</p>
        <div className={styles.analyticsCard} aria-hidden="true">
          <div className={styles.analyticsHeading}>
            <span>Visitors</span>
            <strong>1,284</strong>
          </div>
          <svg viewBox="0 0 440 132" preserveAspectRatio="none">
            <path d="M0 104 C40 94 48 112 82 86 S135 91 165 68 214 82 250 48 290 62 323 32 368 52 400 24 423 37 440 8" />
            <path className={styles.analyticsFill} d="M0 104 C40 94 48 112 82 86 S135 91 165 68 214 82 250 48 290 62 323 32 368 52 400 24 423 37 440 8 V132 H0Z" />
          </svg>
        </div>
      </section>
    ),
    footer: <span>Your data stays in your project.</span>,
  };
}

function NanogresPresentation(): ConsumerAuthPresentation {
  return {
    brand: (
      <div className={styles.brand}>
        <Image src="/auth-brands/nanogres.png" width={30} height={30} alt="" />
        <span>nanogres</span>
      </div>
    ),
    aside: (
      <section className={styles.nanogres}>
        <p className={styles.eyebrow}>POSTGRES FOR YOUR PROJECTS</p>
        <h1>A clearer home for your Postgres databases.</h1>
        <p>
          Keep the essentials close: project databases, access roles, and recoverable backups for
          the Postgres server you manage.
        </p>
        <ul className={styles.features}>
          <li>
            <strong>Know what is running</strong>
            <span>See database health, size, and active connections.</span>
          </li>
          <li>
            <strong>Keep access intentional</strong>
            <span>Manage project roles with permissions checked on every action.</span>
          </li>
          <li>
            <strong>Recover with confidence</strong>
            <span>Download a dump or restore a trusted file into a new database.</span>
          </li>
        </ul>
        <div className={styles.privateCard}>
          <strong>Private by design</strong>
          <span>Nanogres checks organization access on the server.</span>
        </div>
      </section>
    ),
    footer: <span>Your database credentials stay on your server.</span>,
  };
}

export function getConsumerAuthPresentation(productId: string): ConsumerAuthPresentation | null {
  switch (productId.trim().toLowerCase()) {
    case "postparticle":
      return PostParticlePresentation();
    case "visitoring":
      return VisitoringPresentation();
    case "nanogres":
      return NanogresPresentation();
    default:
      return null;
  }
}
