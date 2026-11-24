import { AuthCard } from "panel-frame-ui";
import { AuthPageFrame, AuthReturnToSignIn } from "@/components/auth-page-frame";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";

const errorText: Record<string, string> = {
  "mail-not-configured": "Email delivery is not configured. No recovery email was sent.",
  "invalid-email": "Enter a valid email address. No recovery email was sent.",
  "delivery-failed": "The mail provider could not deliver the message. No recovery email was sent.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const mailReady = isMailDeliveryConfigured();
  return (
    <AuthPageFrame>
      <header className="auth-heading">
        <p className="eyebrow">Account recovery</p>
        <h1>Reset your password</h1>
        <p>
          Recovery proves control of the email address and verifies it if it has not been verified
          yet.
        </p>
      </header>
      <AuthCard className="auth-card" aria-labelledby="recovery-title">
        <h2 id="recovery-title">Request recovery link</h2>
        {params.error && errorText[params.error] ? (
          <p className="form-error" role="alert">
            {errorText[params.error]}
          </p>
        ) : null}
        {params.notice === "requested" ? (
          <p className="form-success" role="status">
            If an active account matches that address, a recovery link will arrive if the mail
            provider accepts it.
          </p>
        ) : null}
        {!mailReady ? (
          <p className="form-error" role="status">
            Email delivery is not configured. No recovery email can be sent yet.
          </p>
        ) : null}
        <form action="/actions/requestPasswordRecoveryAction" method="post" className="auth-form">
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
          <button className="button button-primary form-submit" type="submit" disabled={!mailReady}>
            Send recovery link
          </button>
        </form>
        <AuthReturnToSignIn />
      </AuthCard>
    </AuthPageFrame>
  );
}
