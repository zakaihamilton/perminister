import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { resetPasswordAction } from "@/app/actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return (
    <>
      <SiteHeader active="none" />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <section className="auth-card" aria-labelledby="reset-title">
            <p className="eyebrow">Account recovery</p>
            <h1 id="reset-title">Choose a new password</h1>
            {params.error === "password-policy" ? (
              <p className="form-error" role="alert">
                Use a password with at least 15 characters.
              </p>
            ) : null}
            {params.error === "password-mismatch" ? (
              <p className="form-error" role="alert">
                The passwords do not match.
              </p>
            ) : null}
            {params.error === "invalid-link" ? (
              <p className="form-error" role="alert">
                This recovery link is invalid, expired, or already used.
              </p>
            ) : null}
            {token ? (
              <form action={resetPasswordAction} className="auth-form">
                <input type="hidden" name="token" value={token} />
                <label>
                  New password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={256}
                    required
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={256}
                    required
                  />
                </label>
                <button className="button button-primary form-submit" type="submit">
                  Save new password
                </button>
              </form>
            ) : (
              <p className="form-error">This recovery link is missing its one-time token.</p>
            )}
            <div className="auth-links">
              <Link href="/login">Return to sign in</Link>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
