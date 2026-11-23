import type { ReactNode } from "react";
import {
  DeveloperGuideNav,
  type DeveloperSection,
  SiteFooter,
  SiteHeader,
} from "@/components/site-shell";
import { WelcomeAccessIllustration } from "@/components/welcome-access-illustration";

export function DeveloperGuideLayout({
  active,
  eyebrow,
  title,
  intro,
  children,
}: {
  active: DeveloperSection;
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader active="developers" />
      <main className="page-shell">
        <div className="container developers-page">
          <DeveloperGuideNav active={active} />
          <header
            className={`developer-hero${active === "overview" ? " developer-hero-with-image" : ""}`}
          >
            <div className="developer-hero-copy">
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              <p>{intro}</p>
            </div>
            {active === "overview" ? (
              <div className="developer-hero-image">
                <WelcomeAccessIllustration />
              </div>
            ) : null}
          </header>
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
