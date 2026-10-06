import type { ReactNode } from "react";
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
          <header className="developer-hero">
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{intro}</p>
          </header>
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
