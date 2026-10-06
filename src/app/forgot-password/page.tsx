import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { requestPasswordRecoveryAction } from "@/app/actions";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";

const errorText: Record<string, string> = {
  "mail-not-configured": "Resend is not configured. No recovery email was sent.",
  "invalid-email": "Enter a valid email address. No recovery email was sent.",
  "delivery-failed": "Resend did not accept the message. No recovery email was sent.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const mailReady = isMailDeliveryConfigured();
  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <header className="auth-heading">
            <p className="eyebrow">Account recovery</p>
            <h1>Reset your password</h1>
            <p>Recovery proves control of the email address and verifies it if it has not been verified yet.</p>
          </header>
          <section className="auth-card" aria-labelledby="recovery-title">
            <h2 id="recovery-title">Request recovery link</h2>
            {params.error && errorText[params.error] ? <p className="form-error" role="alert">{errorText[params.error]}</p> : null}
            {params.notice === "requested" ? <p className="form-success" role="status">If an active account matches that address, a recovery link will arrive if Resend accepts it.</p> : null}
            {!mailReady ? <p className="form-error" role="status">Resend is not configured. No recovery email can be sent yet.</p> : null}
            <form action={requestPasswordRecoveryAction} className="auth-form">
              <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
              <button className="button button-primary form-submit" type="submit" disabled={!mailReady}>Send recovery link</button>
            </form>
            <div className="auth-links"><Link href="/login">Return to sign in</Link></div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
