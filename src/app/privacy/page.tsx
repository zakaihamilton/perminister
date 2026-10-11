import type { Metadata } from "next";
import { PrivacyPolicySections } from "@/components/privacy-policy-sections";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Learn what information Perminister uses to provide identity and access management, how it is stored, and how to make a privacy request.",
};

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader active="none" />
      <main className="page-shell privacy-page">
        <article className="container privacy-document" aria-labelledby="privacy-title">
          <header className="privacy-heading">
            <p className="eyebrow">Legal</p>
            <h1 id="privacy-title">Privacy Policy</h1>
            <p className="privacy-intro">
              Perminister is operated by Zakai Hamilton. This policy explains how information is
              handled when you visit the site or use its identity and access management service.
            </p>
            <p className="privacy-updated">Last updated October 7, 2026</p>
          </header>
          <PrivacyPolicySections />
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
