import type { Metadata } from "next";
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

          <div className="privacy-sections">
            <section aria-labelledby="privacy-information">
              <h2 id="privacy-information">Information the service handles</h2>
              <p>
                Perminister uses information needed to operate accounts, organizations, products,
                and access controls. This can include:
              </p>
              <p>
                When you visit the site, your browser also sends basic connection details such as
                your IP address and the page you request so the service can respond and protect
                itself from misuse.
              </p>
              <ul>
                <li>
                  Account details such as your email address, email verification status, account
                  status, and account timestamps.
                </li>
                <li>
                  Organization and product information, including names, descriptions, website and
                  icon URLs, membership, roles, invitations, and permission grants.
                </li>
                <li>
                  Access records such as API key identifiers, scopes, permitted actions, expiry and
                  revocation status, session expiry and revocation, and security or activity events.
                </li>
                <li>
                  Messages needed to verify an email address, recover an account, or deliver an
                  organization invitation.
                </li>
              </ul>
              <p>
                Passwords, API key secrets, browser session tokens, and one-time email tokens are
                not stored in plain text. The service stores password verifiers or one-way digests
                instead. A newly created API key is shown once so you can save it.
              </p>
            </section>

            <section aria-labelledby="privacy-use">
              <h2 id="privacy-use">How information is used</h2>
              <p>
                Information is used to create and secure accounts, manage organization and product
                membership, apply role and permission settings, authorize API requests, show
                activity history, and send account or invitation messages. These uses support the
                features you or your organization choose to use.
              </p>
              <p>
                If an owner or admin asks Perminister to look up a product website, the server
                requests that public HTTPS page to suggest product details. The website receives a
                request from the Perminister server; account credentials and API secrets are not
                included in that request.
              </p>
            </section>

            <section aria-labelledby="privacy-browser-storage">
              <h2 id="privacy-browser-storage">Cookies and browser storage</h2>
              <p>
                Sign-in uses an HTTP-only session cookie that expires after 12 hours. The site also
                stores your light, dark, or system theme preference in your browser’s local storage.
              </p>
            </section>

            <section aria-labelledby="privacy-sharing">
              <h2 id="privacy-sharing">Storage and service providers</h2>
              <p>
                Perminister stores identity and access records in private DigitalOcean Spaces
                objects. When transactional email is configured, Resend receives the recipient
                address and message content needed to deliver verification, recovery, and invitation
                emails. Product website lookup sends a request to the URL provided by an authorized
                organization owner or admin.
              </p>
              <p>
                Organization owners and admins can see and manage organization or product
                information needed for their roles. Product members can be shown membership and
                access information for the products they use. Applications that integrate with
                Perminister are responsible for their own data and privacy practices.
              </p>
              <p className="privacy-provider-links">
                Provider information:{" "}
                <a href="https://www.digitalocean.com/legal/privacy-policy">
                  DigitalOcean Privacy Policy
                </a>
                {" · "}
                <a href="https://resend.com/legal/privacy-policy">Resend Privacy Policy</a>.
              </p>
            </section>

            <section aria-labelledby="privacy-retention">
              <h2 id="privacy-retention">Retention and account controls</h2>
              <p>
                Perminister keeps account, organization, access, and activity records for as long as
                they are needed to provide the service, maintain security, and keep access history.
                Expired or revoked records may remain available as part of that history; the service
                does not publish a fixed deletion schedule.
              </p>
              <p>
                You can sign out, revoke browser sessions, and manage API keys through account
                controls. Perminister does not currently provide a self-service account deletion
                feature. For access, correction, or deletion requests, contact the service operator
                using the contact information below. Requests may be subject to applicable law and
                records needed for security or service operation.
              </p>
            </section>

            <section aria-labelledby="privacy-security">
              <h2 id="privacy-security">Security</h2>
              <p>
                The service uses private storage objects and one-way verifiers for sensitive
                credentials. Access records are scoped to organizations and products. No method of
                storage or transmission can be guaranteed to be completely secure.
              </p>
            </section>

            <section aria-labelledby="privacy-changes">
              <h2 id="privacy-changes">Changes to this policy</h2>
              <p>
                If this policy changes, the updated version will appear on this page with a revised
                “Last updated” date.
              </p>
            </section>

            <section aria-labelledby="privacy-contact">
              <h2 id="privacy-contact">Contact</h2>
              <p>
                For privacy questions or requests, contact Zakai Hamilton, the Perminister operator,
                at <a href="mailto:zakaihamilton@gmail.com">zakaihamilton@gmail.com</a>.
              </p>
            </section>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
