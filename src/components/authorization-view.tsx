import { SiteFooter, SiteHeader } from "@/components/site-shell";

export function AuthorizationView({ error }: { error: string }) {
  const unavailable = error === "unavailable";

  return (
    <>
      <SiteHeader active="none" />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <header className="auth-heading">
            <p className="eyebrow">Perminister identity</p>
            <h1>{unavailable ? "Sign-in temporarily unavailable" : "Sign-in request unavailable"}</h1>
            <p role="alert">
              {unavailable
                ? "Perminister could not complete sign-in right now. Return to the product and try again."
                : "This sign-in request is invalid or expired. Return to the product and try again."}
            </p>
          </header>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
