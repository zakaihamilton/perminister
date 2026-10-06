import type { ReactNode } from "react";
import Image from "next/image";
import {
  DeveloperGuideNav,
  SiteFooter,
  SiteHeader,
  type DeveloperSection,
} from "@/components/site-shell";

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
          <header className={`developer-hero${active === "overview" ? " developer-hero-with-image" : ""}`}>
            <div className="developer-hero-copy">
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              <p>{intro}</p>
            </div>
            {active === "overview" ? (
              <Image
                alt="A server checks a scoped key before allowing access to a protected resource."
                className="developer-hero-image"
                height={809}
                sizes="(max-width: 740px) 100vw, 34vw"
                src="/illustrations/server-key-flow.png"
                width={1942}
              />
            ) : null}
          </header>
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
