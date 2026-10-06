import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { registerAction } from "@/app/actions";
import { getCurrentSession } from "@/lib/auth/service";

const errorText: Record<string, string> = {
  "account-exists": "An account with this email address already exists. Sign in instead.",
  "invalid-email": "Enter a valid email address.",
  "password-policy": "Use a password with at least 15 characters.",
  "password-mismatch": "The passwords do not match.",
  "registration-unavailable": "Account creation is unavailable right now. Check the Spaces configuration and try again.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const current = await getCurrentSession();
  if (current) redirect("/dashboard");
  const params = await searchParams;
  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <header className="auth-heading">
            <p className="eyebrow">Create your identity</p>
            <h1>One account for shared access</h1>
            <p>Perminister stores your identity and password verifier in the configured private Spaces bucket.</p>
          </header>
          <section className="auth-card" aria-labelledby="register-title">
            <h2 id="register-title">Create account</h2>
            {params.error && errorText[params.error] ? <p className="form-error" role="alert">{errorText[params.error]}</p> : null}
            <form action={registerAction} className="auth-form">
              <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
              <label>Password<input name="password" type="password" autoComplete="new-password" minLength={15} maxLength={256} required /><span className="form-hint">Use at least 15 characters.</span></label>
              <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={15} maxLength={256} required /></label>
              <button className="button button-primary form-submit" type="submit">Create account</button>
            </form>
            <p className="auth-footnote">An account is not automatically linked to any existing application identity.</p>
            <div className="auth-links"><span>Already have an account? <Link href="/login">Sign in</Link></span></div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
