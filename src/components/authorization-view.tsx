import { SiteFooter, SiteHeader } from "@/components/site-shell";
import type { ConsumerAuthorizationRequest } from "@/lib/auth/consumer-sso";

type AuthorizationViewProps =
  | {
      error: string;
      authorization: ConsumerAuthorizationRequest;
      signedInAs: string;
    }
  | {
      error: string;
      authorization?: undefined;
      signedInAs?: never;
    };

export function AuthorizationView({
  error,
  authorization,
  signedInAs,
}: AuthorizationViewProps) {
  const unavailable = error === "unavailable";
  const consent = authorization !== undefined;

  function requestFields() {
    if (!authorization) return null;
    return (
      <>
        <input name="client_id" type="hidden" value={authorization.clientId} />
        <input name="redirect_uri" type="hidden" value={authorization.redirectUri} />
        <input name="response_type" type="hidden" value={authorization.responseType} />
        <input name="state" type="hidden" value={authorization.state} />
        <input name="code_challenge" type="hidden" value={authorization.codeChallenge} />
        <input name="code_challenge_method" type="hidden" value="S256" />
        {authorization.scope ? (
          <input name="scope" type="hidden" value={authorization.scope} />
        ) : null}
        {authorization.nonce ? (
          <input name="nonce" type="hidden" value={authorization.nonce} />
        ) : null}
        {authorization.resource ? (
          <input name="resource" type="hidden" value={authorization.resource} />
        ) : null}
        {authorization.prompt ? (
          <input name="prompt" type="hidden" value={authorization.prompt} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <SiteHeader active="none" authenticated={consent} />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <header className="auth-heading">
            <p className="eyebrow">Perminister identity</p>
            {consent ? (
              <>
                <p className="auth-account-context">
                  Signed in as <strong>{signedInAs}</strong>
                </p>
                <h1>Allow {authorization.clientName} to access this resource?</h1>
                <p>{authorization.resource}</p>
                <p>It is requesting these permissions:</p>
                <ul>
                  {authorization.scopes.map((scope) => (
                    <li key={scope}>
                      <code>{scope}</code>
                    </li>
                  ))}
                </ul>
                <p>Perminister will still check your current access for every protected action.</p>
                <div className="consumer-client-edit-actions">
                  <form action="/actions/cancelConsumerAuthorizationAction" method="post">
                    {requestFields()}
                    <button className="button button-secondary" type="submit">
                      Deny
                    </button>
                  </form>
                  <form action="/actions/approveConsumerAuthorizationAction" method="post">
                    {requestFields()}
                    <button className="button button-primary" type="submit">
                      Allow access
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <h1>
                  {unavailable ? "Sign-in temporarily unavailable" : "Sign-in request unavailable"}
                </h1>
                <p role="alert">
                  {unavailable
                    ? "Perminister could not complete sign-in right now. Return to the product and try again."
                    : "This sign-in request is invalid or expired. Return to the product and try again."}
                </p>
              </>
            )}
          </header>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
