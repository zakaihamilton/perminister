import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { registerAction } from "@/app/actions";
import { getCurrentSession } from "@/lib/auth/service";

const errorText: Record<string, string> = {
  "account-exists": "An account with this email address already exists. Sign in instead.",
  "invalid-email": "Enter a valid email address.",
  "invalid-name": "Names must be 80 characters or fewer.",
  "password-policy": "Use a password with at least 15 characters.",
  "password-mismatch": "The passwords do not match.",
  "registration-unavailable":
    "Account creation is unavailable right now. Check the Spaces configuration and try again.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invitationToken?: string }>;
}) {
  const params = await searchParams;
  const current = await getCurrentSession();
  if (current)
    redirect(
      params.invitationToken
        ? `/accept-invitation?token=${encodeURIComponent(params.invitationToken)}`
        : "/dashboard",
    );
  const invitationToken = params.invitationToken ?? "";
  return (
    <>
      <SiteHeader active="none" authenticated={false} />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <header className="auth-heading">
            <p className="eyebrow">Create an account</p>
            <h1>Your account, in one place</h1>
            <p>
              Use one account to join organizations and manage your profile, sessions, and API keys.
            </p>
          </header>
          <section className="auth-card" aria-labelledby="register-title">
            <h2 id="register-title">Create account</h2>
            {invitationToken ? (
              <p className="form-success" role="status">
                Create your account with the email address that received your invitation.
              </p>
            ) : null}
            {params.error && errorText[params.error] ? (
              <p className="form-error" role="alert">
                {errorText[params.error]}
              </p>
            ) : null}
            <form action={registerAction} className="auth-form">
              {invitationToken ? (
                <input type="hidden" name="invitationToken" value={invitationToken} />
              ) : null}
              <label>
                First name
                <input
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  maxLength={80}
                />
              </label>
              <label>
                Last name
                <input
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  maxLength={80}
                />
              </label>
              <label>
                Email address
                <input name="email" type="email" autoComplete="email" maxLength={254} required />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={256}
                  required
                />
                <span className="form-hint">Use at least 15 characters.</span>
              </label>
              <label>
                Confirm password
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
                Create account
              </button>
            </form>
            <div className="auth-links">
              <span>
                Already have an account?{" "}
                <Link
                  href={
                    invitationToken
                      ? `/login?invitationToken=${encodeURIComponent(invitationToken)}`
                      : "/login"
                  }
                >
                  Sign in
                </Link>
              </span>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
