import { SiteFooter, SiteHeader } from "@/components/site-shell";
import type { ConsumerAuthorizationRequest } from "@/lib/auth/consumer-sso";

function AuthorizationFormFields({
  authorization,
}: {
  authorization: ConsumerAuthorizationRequest;
}) {
  return (
    <>
      <input type="hidden" name="client_id" value={authorization.clientId} />
      <input type="hidden" name="redirect_uri" value={authorization.redirectUri} />
      <input type="hidden" name="response_type" value={authorization.responseType} />
      <input type="hidden" name="state" value={authorization.state} />
      <input type="hidden" name="code_challenge" value={authorization.codeChallenge} />
      <input type="hidden" name="code_challenge_method" value="S256" />
    </>
  );
}

export function AuthorizationView({
  authorization,
  client,
  current,
  error,
  headerAuthenticated,
}: {
  authorization: ConsumerAuthorizationRequest | null;
  client: { appName: string } | null;
  current: { subject: { primaryEmail: string | null } } | null;
  error: string;
  headerAuthenticated?: boolean;
}) {
  const heading =
    authorization && client ? `Continue to ${client.appName}` : "Sign-in request unavailable";
  return (
    <>
      <SiteHeader active="none" authenticated={headerAuthenticated} />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <header className="auth-heading">
            <p className="eyebrow">Perminister identity</p>
            <h1>{heading}</h1>
            <p>Use your Perminister account to continue to this product.</p>
          </header>
          <section className="auth-card" aria-labelledby="authorization-title">
            <h2 id="authorization-title">Confirm sign-in</h2>
            {!authorization || !client || !current ? (
              <p className="form-error" role="alert">
                This sign-in request is invalid or expired. Return to the product and try again.
              </p>
            ) : error === "unavailable" ? (
              <p className="form-error" role="alert">
                Perminister could not complete sign-in right now. Please try again.
              </p>
            ) : null}
            {authorization && client && current ? (
              <>
                <p className="form-hint">
                  Signed in as{" "}
                  <strong>{current.subject.primaryEmail ?? "your Perminister account"}</strong>.
                  Perminister will confirm your access when {client.appName} opens.
                </p>
                <form
                  action="/actions/approveConsumerAuthorizationAction"
                  method="post"
                  className="auth-form"
                >
                  <AuthorizationFormFields authorization={authorization} />
                  <button className="button button-primary form-submit" type="submit">
                    Continue to {client.appName}
                  </button>
                </form>
                <form
                  action="/actions/cancelConsumerAuthorizationAction"
                  method="post"
                  className="auth-form"
                >
                  <AuthorizationFormFields authorization={authorization} />
                  <button className="button button-secondary form-submit" type="submit">
                    Cancel
                  </button>
                </form>
              </>
            ) : null}
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
