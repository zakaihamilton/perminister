import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { getConsumerClientRecord, getCurrentSession } from "@/lib/auth/service";
import {
  consumerAuthorizationQuery,
  parseConsumerAuthorizationRequest,
  safeConsumerAuthorizationReturnTo,
  type ConsumerAuthorizationRequest,
} from "@/lib/auth/consumer-sso";
import { approveConsumerAuthorizationAction, cancelConsumerAuthorizationAction } from "./action";

function singleValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

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

export default async function ConsumerAuthorizationPage({
  searchParams,
}: {
  searchParams: Promise<{
    client_id?: string | string[];
    redirect_uri?: string | string[];
    response_type?: string | string[];
    state?: string | string[];
    code_challenge?: string | string[];
    code_challenge_method?: string | string[];
    error?: string | string[];
  }>;
}) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const key of [
    "client_id",
    "redirect_uri",
    "response_type",
    "state",
    "code_challenge",
    "code_challenge_method",
  ] as const) {
    const value = singleValue(values[key]);
    if (value) params.set(key, value);
  }

  const client = await getConsumerClientRecord(params.get("client_id") ?? "").catch(() => null);
  const authorization = parseConsumerAuthorizationRequest(params, client);
  const current = authorization ? await getCurrentSession() : null;
  if (authorization && client && !current) {
    const returnTo = safeConsumerAuthorizationReturnTo(
      `/oauth/authorize?${consumerAuthorizationQuery(authorization)}`,
    );
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login?error=sso");
  }

  const error = singleValue(values.error);
  const heading =
    authorization && client ? `Continue to ${client.appName}` : "Sign-in request unavailable";
  return (
    <>
      <SiteHeader active="none" />
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
                <form action={approveConsumerAuthorizationAction} className="auth-form">
                  <AuthorizationFormFields authorization={authorization} />
                  <button className="button button-primary form-submit" type="submit">
                    Continue to {client.appName}
                  </button>
                </form>
                <form action={cancelConsumerAuthorizationAction} className="auth-form">
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
