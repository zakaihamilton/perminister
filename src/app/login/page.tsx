import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { signInAction } from "@/app/actions";
import { getCurrentSession } from "@/lib/auth/service";

const errorText: Record<string, string> = {
  credentials: "Email or password is incorrect.",
  throttled: "Too many sign-in attempts. Try again in 15 minutes.",
  unavailable: "Sign-in is unavailable right now. Check the Spaces configuration and try again.",
};

const noticeText: Record<string, string> = {
  "email-verified": "Your email address is verified. You can sign in.",
  "password-reset": "Your password was changed. Sign in with the new password.",
  "account-created-mail-unconfigured": "Your account was created. Resend is not configured, so no verification email was sent. You can sign in; email verification and recovery require Resend configuration.",
  "verification-sent": "A verification link was sent. You can sign in while it is pending.",
  "verification-delivery-failed": "Your account was created, but the verification message could not be delivered. You can sign in and request another after checking mail settings.",
  "invitation-accepted-sign-in": "Your invitation was accepted. Sign in to continue to the organization.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; invitationToken?: string }>;
}) {
  const params = await searchParams;
  const current = await getCurrentSession();
  if (current) redirect(params.invitationToken ? `/accept-invitation?token=${encodeURIComponent(params.invitationToken)}` : "/dashboard");
  const invitationToken = params.invitationToken ?? "";
  return (
    <>
      <SiteHeader active="none" authenticated={false} />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">
          <header className="auth-heading">
            <p className="eyebrow">Account access</p>
            <h1>Sign in to Perminister</h1>
            <p>Use your central identity to manage permissions and API keys.</p>
          </header>
          <section className="auth-card" aria-labelledby="login-title">
            <h2 id="login-title">Sign in</h2>
            {invitationToken ? <p className="form-success" role="status">Sign in with the email address that received your invitation.</p> : null}
            {params.error && errorText[params.error] ? <p className="form-error" role="alert">{errorText[params.error]}</p> : null}
            {params.notice && noticeText[params.notice] ? <p className="form-success" role="status">{noticeText[params.notice]}</p> : null}
            <form action={signInAction} className="auth-form">
              {invitationToken ? <input type="hidden" name="invitationToken" value={invitationToken} /> : null}
              <label>Email address<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
              <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required /></label>
              <button className="button button-primary form-submit" type="submit">Sign in</button>
            </form>
            <div className="auth-links">
              <Link href="/forgot-password">Forgot password?</Link>
              <span>New here? <Link href={invitationToken ? `/register?invitationToken=${encodeURIComponent(invitationToken)}` : "/register"}>Create an account</Link></span>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
