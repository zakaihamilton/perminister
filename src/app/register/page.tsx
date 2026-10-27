import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthPageFeedback } from "@/components/auth-page-feedback";
import { PasswordField } from "@/components/password-field";
import { AuthPageFrame } from "@/components/auth-page-frame";
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
    <AuthPageFrame authenticated={false}>
      <header className="auth-heading">
        <p className="eyebrow">Create an account</p>
        <h1 id="register-title">Create your account</h1>
        <p>
          Use one account to join organizations and manage your profile, sessions, and API keys.
        </p>
      </header>
      <section className="auth-card" aria-labelledby="register-title">
        <AuthPageFeedback
          error={params.error}
          errorText={errorText}
          invitationMessage={
            invitationToken
              ? "Create your account with the email address that received your invitation."
              : undefined
          }
        />
        <form action="/actions/registerAction" method="post" className="auth-form">
          {invitationToken ? (
            <input type="hidden" name="invitationToken" value={invitationToken} />
          ) : null}
          <div className="auth-name-fields">
            <label>
              First name
              <input name="firstName" type="text" autoComplete="given-name" maxLength={80} />
            </label>
            <label>
              Last name
              <input name="lastName" type="text" autoComplete="family-name" maxLength={80} />
            </label>
          </div>
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
          <PasswordField
            label="Password"
            name="password"
            autoComplete="new-password"
            minLength={15}
            hint="Use at least 15 characters."
          />
          <PasswordField
            label="Confirm password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={15}
          />
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
    </AuthPageFrame>
  );
}
