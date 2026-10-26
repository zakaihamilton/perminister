import Link from "next/link";
import { AuthPageFrame, AuthReturnToSignIn } from "@/components/auth-page-frame";
import { getAuthLinkPageContext } from "@/lib/auth/auth-link-page-context";

type AuthLinkPageProps = {
  searchParams: Promise<{ token?: string; error?: string }>;
};

function createAuthLinkPage(kind: "reset-password" | "verify-email") {
  return async function AuthLinkPage({ searchParams }: AuthLinkPageProps) {
    const { params, token } = await getAuthLinkPageContext(searchParams);
    const content =
      kind === "reset-password" ? (
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
            <form action="/actions/resetPasswordAction" method="post" className="auth-form">
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
          <AuthReturnToSignIn />
        </section>
      ) : (
        <section className="auth-card" aria-labelledby="verify-title">
          <p className="eyebrow">Email verification</p>
          <h1 id="verify-title">Confirm your email address</h1>
          {params.error ? (
            <p className="form-error" role="alert">
              This verification link is invalid, expired, or already used.
            </p>
          ) : null}
          {token ? (
            <form action="/actions/verifyEmailAction" method="post" className="auth-form">
              <input type="hidden" name="token" value={token} />
              <button className="button button-primary form-submit" type="submit">
                Verify email
              </button>
            </form>
          ) : (
            <p className="form-error">This verification link is missing its one-time token.</p>
          )}
          <div className="auth-links">
            <Link href="/login">Continue to sign in</Link>
          </div>
        </section>
      );

    return <AuthPageFrame>{content}</AuthPageFrame>;
  };
}

export const ResetPasswordPage = createAuthLinkPage("reset-password");
export const VerifyEmailPage = createAuthLinkPage("verify-email");
