import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "panel-frame-ui";
import { AuthPageFeedback } from "@/components/auth-page-feedback";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { PasswordField } from "@/components/password-field";
import { type AuthPageProps, authPageContext } from "@/lib/auth/auth-page-context";
import { postLoginDestination } from "@/lib/auth/login-redirect";
import { getCurrentSession } from "@/lib/auth/service";

const errorText: Record<string, string> = {
  "account-exists": "An account with this email address already exists. Sign in instead.",
  "invalid-email": "Enter a valid email address.",
  "invalid-name": "Names must be 80 characters or fewer.",
  "password-policy": "Use a password with at least 15 characters.",
  "password-mismatch": "The passwords do not match.",
  "invalid-systemconcepts-id": "Use 1 to 254 letters, numbers, underscores, or hyphens for your System Concepts ID.",
  "systemconcepts-id-in-use": "That System Concepts ID is already in use.",
  "registration-unavailable":
    "Account creation is unavailable right now. Check the storage configuration and try again.",
};

export default async function RegisterPage({ searchParams }: AuthPageProps) {
  const { params, next, client, authorization } = await authPageContext(searchParams);
  const systemConceptsRegistration = Boolean(
    authorization &&
      client?.productId.trim().toLowerCase() === "system-concepts" &&
      client.selfRegistrationEnabled,
  );
  const current = await getCurrentSession();
  if (current) redirect(postLoginDestination(next, params.invitationToken ?? ""));
  const invitationToken = params.invitationToken ?? "";
  const signInParams = new URLSearchParams();
  if (next) signInParams.set("next", next);
  if (invitationToken) signInParams.set("invitationToken", invitationToken);
  return (
    <AuthPageFrame>
      <header className="auth-heading">
        <p className="eyebrow">Create an account</p>
        <h1 id="register-title">Create your account</h1>
        <p>
          Use one account to join organizations and manage your profile, sessions, and API keys.
        </p>
      </header>
      <AuthCard className="auth-card" aria-labelledby="register-title">
        <AuthPageFeedback
          error={params.error}
          errorText={errorText}
          notice={params.notice}
          noticeText={{
            "registration-requested":
              "If you can register with this address, check your email for next steps. If you already have an account, sign in or reset your password. If no message arrives, contact the administrator.",
          }}
          invitationMessage={
            invitationToken
              ? "Create your account with the email address that received your invitation."
              : undefined
          }
        />
        <form action="/actions/registerAction" method="post" className="auth-form">
          {next ? <input type="hidden" name="next" value={next} /> : null}
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
          {systemConceptsRegistration ? (
            <label>
              System Concepts ID
              <input
                name="systemConceptsId"
                type="text"
                autoComplete="username"
                maxLength={254}
                pattern="[A-Za-z0-9_-]{1,254}"
                required
              />
              <span className="auth-footnote">
                Sign in to System Concepts with this ID or your email address.
              </span>
            </label>
          ) : null}
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
                `/login${signInParams.size ? `?${signInParams.toString()}` : ""}`
              }
            >
              Sign in
            </Link>
          </span>
        </div>
      </AuthCard>
    </AuthPageFrame>
  );
}
