import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthPageFeedback } from "@/components/auth-page-feedback";
import { PasswordField } from "@/components/password-field";
import { AuthCard } from "panel-frame-ui";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { getCurrentSession, getConsumerClientRecord } from "@/lib/auth/service";
import {
  legacyConsumerAuthorizationEnabled,
  parseConsumerAuthorizationRequest,
  safeConsumerAuthorizationReturnTo,
} from "@/lib/auth/consumer-sso";
import { getConsumerAuthPresentation } from "@/components/consumer-auth-presentation";

const errorText: Record<string, string> = {
  credentials: "Email or password is incorrect.",
  throttled: "Too many sign-in requests. Please wait a while and try again.",
  request: "Your sign-in request could not be verified. Reload the page and try again.",
  unavailable: "Sign-in is unavailable right now. Check the Spaces configuration and try again.",
  sso: "This product sign-in request is invalid or has expired. Return to the product and try again.",
};

const noticeText: Record<string, string> = {
  "email-verified": "Your email address is verified. You can sign in.",
  "password-reset": "Your password was changed. Sign in with the new password.",
  "account-created-mail-unconfigured":
    "Your account was created. Resend is not configured, so no verification email was sent. You can sign in; email verification and recovery require Resend configuration.",
  "verification-sent": "A verification link was sent. You can sign in while it is pending.",
  "verification-delivery-failed":
    "Your account was created, but the verification message could not be delivered. You can sign in and request another after checking mail settings.",
  "invitation-accepted-sign-in":
    "Your invitation was accepted. Sign in to continue to the organization.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    notice?: string;
    invitationToken?: string;
    next?: string;
  }>;
}) {
  const params = await searchParams;
  const next = safeConsumerAuthorizationReturnTo(params.next ?? "");
  let presentation = null;
  if (next) {
    const authorizeUrl = new URL(next, "https://perminister.invalid");
    const clientId = authorizeUrl.searchParams.get("client_id") ?? "";
    const client = await getConsumerClientRecord(clientId).catch(() => null);
    const authorization = parseConsumerAuthorizationRequest(authorizeUrl.searchParams, client, {
      allowLegacy: legacyConsumerAuthorizationEnabled(),
    });
    if (authorization && client) presentation = getConsumerAuthPresentation(client.productId);
  }
  const current = await getCurrentSession();
  const promptLogin = Boolean(
    next && new URL(next, "https://perminister.invalid").searchParams.get("prompt") === "login",
  );
  if (current && !promptLogin)
    redirect(
      next ??
        (params.invitationToken
          ? `/accept-invitation?token=${encodeURIComponent(params.invitationToken)}`
          : "/dashboard"),
    );
  const invitationToken = params.invitationToken ?? "";
  return (
    <AuthPageFrame presentation={presentation}>
      <header className="auth-heading login-heading">
        <p className="eyebrow">Account access</p>
        <h1 id="login-title">Sign in to Perminister</h1>
        <p>Sign in to manage your organizations, products, and access.</p>
      </header>
      <AuthCard className="auth-card" aria-labelledby="login-title">
        <AuthPageFeedback
          error={params.error}
          errorText={errorText}
          notice={params.notice}
          noticeText={noticeText}
          invitationMessage={
            invitationToken
              ? "Sign in with the email address that received your invitation."
              : undefined
          }
        />
        <form action="/login/submit" method="post" className="auth-form">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          {promptLogin ? <input type="hidden" name="prompt" value="login" /> : null}
          {invitationToken ? (
            <input type="hidden" name="invitationToken" value={invitationToken} />
          ) : null}
          <label>
            Email address
            <input name="email" type="email" autoComplete="username" maxLength={254} required />
          </label>
          <PasswordField label="Password" name="password" autoComplete="current-password" />
          <button className="button button-primary form-submit" type="submit">
            Sign in
          </button>
        </form>
        <div className="auth-links">
          <Link href="/forgot-password">Forgot password?</Link>
          <span>
            New here?{" "}
            <Link
              href={
                invitationToken
                  ? `/register?invitationToken=${encodeURIComponent(invitationToken)}`
                  : "/register"
              }
            >
              Create an account
            </Link>
          </span>
        </div>
      </AuthCard>
    </AuthPageFrame>
  );
}
