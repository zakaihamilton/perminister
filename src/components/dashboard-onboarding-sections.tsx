import { isMailDeliveryConfigured } from "@/lib/auth/mail";

export function DashboardOnboardingNotices({
  email,
  error,
  notice,
}: {
  email: string | null;
  error?: string;
  notice?: string;
}) {
  return (
    <>
      {error === "organization-create" ? (
        <p className="form-error" role="alert">
          Your organization request could not be submitted. Check your account and try again.
        </p>
      ) : null}
      {error === "organization-pending" ? (
        <p className="form-error" role="alert">
          You already have an organization request waiting for review.
        </p>
      ) : null}
      {notice === "organization-pending" ? (
        <p className="dashboard-notice info" role="status">
          Your request was submitted. You can use the organization after it is approved.
        </p>
      ) : null}
      {notice === "account-created-mail-unconfigured" ? (
        <p className="dashboard-notice info" role="status">
          Your account was created. Email delivery is not configured, so verify your address before
          creating an organization.
        </p>
      ) : null}
      {notice === "verification-sent" ? (
        <p className="dashboard-notice success" role="status">
          We sent a verification link to <strong>{email ?? "your email address"}</strong>. Check
          your inbox and spam folder.
        </p>
      ) : null}
      {notice === "email-already-verified" ? (
        <p className="dashboard-notice success" role="status">
          Your email address is already verified. You can request an organization now.
        </p>
      ) : null}
      {notice === "mail-not-configured" ? (
        <p className="dashboard-notice error" role="alert">
          Email delivery is not configured, so we could not send a verification link. Ask the
          Perminister operator to configure email delivery.
        </p>
      ) : null}
      {notice === "verification-delivery-failed" ? (
        <p className="dashboard-notice error" role="alert">
          We could not send the verification email. Check your inbox before trying again, or contact
          the Perminister operator.
        </p>
      ) : null}
    </>
  );
}

function EmailVerificationCard() {
  return (
    <section className="onboarding-card">
      <span className="onboarding-step">01</span>
      <div>
        <h2>Verify your email address</h2>
        <p>We verify your email to protect organization ownership and invitations.</p>
        {isMailDeliveryConfigured() ? (
          <form action="/actions/requestVerificationAction" method="post">
            <input type="hidden" name="returnTo" value="/dashboard/new-organization" />
            <button className="button button-primary" type="submit">
              Send verification link
            </button>
          </form>
        ) : (
          <p className="form-hint">
            Email delivery is unavailable. Contact a Perminister administrator before continuing.
          </p>
        )}
      </div>
    </section>
  );
}

export function OrganizationSetupStep({ verified }: { verified: boolean }) {
  if (!verified) return <EmailVerificationCard />;
  return null;
}
