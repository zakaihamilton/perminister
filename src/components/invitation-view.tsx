import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export function InvitationView({
  token,
  hasToken,
  current,
  error,
}: {
  token: string;
  hasToken: boolean;
  current: { subject: { primaryEmail: string | null } } | null;
  error?: string;
}) {
  return (
    <>
      <SiteHeader active="none" authenticated={!!current} />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <header className="auth-heading">
            <p className="eyebrow">Join a workspace</p>
            <h1>Accept your invitation</h1>
            <p>Join your organization to see products, access, and account settings.</p>
          </header>
          <section className="auth-card">
            <h2>Organization invitation</h2>
            {error === "invalid" || (token && !hasToken) ? (
              <p className="form-error" role="alert">
                This invitation is invalid, expired, or addressed to another email. Sign in with the
                invited address or ask the organization owner to send a new one.
              </p>
            ) : null}
            {!token ? (
              <p className="muted">Open the invitation link from your email to continue.</p>
            ) : null}
            {hasToken && current ? (
              <>
                <p className="muted">
                  Signed in as <strong>{current.subject.primaryEmail}</strong>. The invitation can
                  only be accepted by the email address it was sent to.
                </p>
                <form
                  action="/actions/acceptOrganizationInvitationAction"
                  method="post"
                  className="auth-form"
                >
                  <input type="hidden" name="token" value={token} />
                  <button className="button button-primary form-submit" type="submit">
                    Accept invitation
                  </button>
                </form>
              </>
            ) : null}
            {hasToken && !current ? (
              <div className="invitation-auth-links">
                <Link
                  className="button button-primary"
                  href={`/login?invitationToken=${encodeURIComponent(token)}`}
                >
                  Sign in to accept
                </Link>
                <Link
                  className="button button-secondary"
                  href={`/register?invitationToken=${encodeURIComponent(token)}`}
                >
                  Create an account
                </Link>
              </div>
            ) : null}
            <div className="auth-links">
              <Link href="/">Back to home</Link>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
