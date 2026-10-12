import Link from "next/link";
import { createOrganizationAction, requestVerificationAction } from "@/app/actions";
import { OrganizationRequestHistoryRecord } from "@/components/organization-request-history-record";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
import type { OrganizationRequestSummary } from "@/lib/auth/service";

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

function PendingOrganizationCard({ request }: { request: OrganizationRequestSummary }) {
  return (
    <section className="onboarding-card">
      <span className="onboarding-step">02</span>
      <div>
        <h2>Organization request pending</h2>
        <p>
          <strong>{request.organization.name}</strong> is waiting for approval by a platform
          administrator. It will be available here after approval.
        </p>
        <span className="record-meta">
          Submitted {new Date(request.organization.createdAt).toLocaleString()}
        </span>
      </div>
    </section>
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
          <form action={requestVerificationAction}>
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

function OrganizationRequestCard() {
  return (
    <section className="onboarding-card">
      <span className="onboarding-step">01</span>
      <div>
        <h2>Request an organization</h2>
        <p>
          You’ll become its Owner if approved. Products, invitations, and access stay unavailable
          until then.
        </p>
        <form action={createOrganizationAction} className="auth-form onboarding-form">
          <label>
            Organization name
            <input name="name" required minLength={2} maxLength={80} placeholder="Acme Studio" />
          </label>
          <button className="button button-primary" type="submit">
            Submit for approval
          </button>
        </form>
      </div>
    </section>
  );
}

export function OrganizationSetupStep({
  pendingRequest,
  verified,
}: {
  pendingRequest: OrganizationRequestSummary | undefined;
  verified: boolean;
}) {
  if (pendingRequest) return <PendingOrganizationCard request={pendingRequest} />;
  if (!verified) return <EmailVerificationCard />;
  return <OrganizationRequestCard />;
}

export function RejectedOrganizationRequestHistory({
  requests,
}: {
  requests: OrganizationRequestSummary[];
}) {
  const rejectedRequests = requests.filter((request) => request.status === "rejected");
  if (!rejectedRequests.length) return null;

  return (
    <section className="dashboard-card organization-request-history">
      <h2>Previous organization requests</h2>
      <div className="record-list">
        {rejectedRequests.map((request) => (
          <OrganizationRequestHistoryRecord
            key={request.organization.organizationId}
            request={request}
            statusLabel="Rejected"
          />
        ))}
      </div>
    </section>
  );
}

export function PlatformOperationsLink({ pendingCount }: { pendingCount: number | null }) {
  return (
    <p className="onboarding-ops-link">
      <Link href="/dashboard/operations">
        Platform admin
        {pendingCount ? ` (${pendingCount} pending organization requests)` : ""}
      </Link>
    </p>
  );
}
