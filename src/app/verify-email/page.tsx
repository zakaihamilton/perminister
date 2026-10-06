import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { verifyEmailAction } from "@/app/actions";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <section className="auth-card" aria-labelledby="verify-title">
            <p className="eyebrow">Email verification</p>
            <h1 id="verify-title">Confirm your email address</h1>
            {params.error ? <p className="form-error" role="alert">This verification link is invalid, expired, or already used.</p> : null}
            {token ? (
              <form action={verifyEmailAction} className="auth-form">
                <input type="hidden" name="token" value={token} />
                <button className="button button-primary form-submit" type="submit">Verify email</button>
              </form>
            ) : (
              <p className="form-error">This verification link is missing its one-time token.</p>
            )}
            <div className="auth-links"><Link href="/login">Continue to sign in</Link></div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
