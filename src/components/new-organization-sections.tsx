import { createOrganizationAction } from "@/app/actions";
import { DashboardNotice } from "@/components/dashboard-shell";
import { OrganizationRequestHistoryRecord } from "@/components/organization-request-history-record";
import type { OrganizationRequestSummary } from "@/lib/auth/service";

export function NewOrganizationRequestNotices({
  error,
  notice,
}: {
  error?: string;
  notice?: string;
}) {
  return (
    <>
      {error === "organization-create" ? (
        <DashboardNotice
          message="Your organization request could not be submitted. Verify your email and try again."
          kind="error"
        />
      ) : null}
      {error === "organization-pending" ? (
        <DashboardNotice
          message="You already have an organization request waiting for review."
          kind="error"
        />
      ) : null}
      {notice === "organization-pending" ? (
        <DashboardNotice
          message="Your request was submitted. You can use the organization after it is approved."
          kind="info"
        />
      ) : null}
    </>
  );
}

export function OrganizationRequestHistory({
  requests,
}: {
  requests: OrganizationRequestSummary[];
}) {
  if (!requests.length) return null;

  return (
    <section className="dashboard-card organization-request-history">
      <div className="dashboard-card-heading">
        <div>
          <h2>Your organization requests</h2>
          <p>Organizations are added to your list after the request is approved.</p>
        </div>
      </div>
      <div className="record-list">
        {requests.map((request) => (
          <OrganizationRequestHistoryRecord
            key={request.organization.organizationId}
            request={request}
          />
        ))}
      </div>
    </section>
  );
}

export function OrganizationRequestSubmission({
  emailVerified,
  hasPendingRequest,
}: {
  emailVerified: boolean;
  hasPendingRequest: boolean;
}) {
  if (!emailVerified) {
    return (
      <DashboardNotice message="Verify your email before creating an organization." kind="error" />
    );
  }
  if (hasPendingRequest) {
    return (
      <section className="dashboard-card new-organization-card">
        <h2>Request under review</h2>
        <p className="form-hint">
          Wait for this request to be approved or rejected before submitting another one.
        </p>
      </section>
    );
  }
  return (
    <section className="dashboard-card new-organization-card">
      <form action={createOrganizationAction} className="auth-form">
        <input type="hidden" name="returnTo" value="/dashboard/new-organization" />
        <label>
          Organization name
          <input name="name" required minLength={2} maxLength={80} placeholder="Acme Studio" />
        </label>
        <p className="form-hint">
          You’ll become the organization owner if approved. You can use it after approval.
        </p>
        <button className="button button-primary" type="submit">
          Submit for approval
        </button>
      </form>
    </section>
  );
}
