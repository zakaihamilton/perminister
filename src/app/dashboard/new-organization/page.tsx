import Link from "next/link";
import { createOrganizationAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice, DashboardShell } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  listOrganizationRequestsForSubject,
  listOrganizationsForSubject,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function NewOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [organizations, requests, query] = await Promise.all([
    listOrganizationsForSubject(current.subject.subjectId),
    listOrganizationRequestsForSubject(current.subject.subjectId),
    searchParams,
  ]);
  if (!organizations.length) redirect("/dashboard");
  const selected = organizations[0];
  return (
    <DashboardShell
      organizationId={selected.organization.organizationId}
      organizationName={selected.organization.name}
      organizations={organizations}
      role={selected.membership.role}
      email={current.subject.primaryEmail}
      firstName={current.subject.firstName ?? null}
      lastName={current.subject.lastName ?? null}
    >
      <DashboardHeading
        description="Every new organization needs platform approval before its workspace can be used."
        action={
          <Link
            className="button button-secondary"
            href={`/dashboard/${selected.organization.organizationId}`}
          >
            Cancel
          </Link>
        }
      />
      {query.error === "organization-create" ? (
        <DashboardNotice
          message="Your organization request could not be submitted. Verify your email and try again."
          kind="error"
        />
      ) : null}
      {query.error === "organization-pending" ? (
        <DashboardNotice
          message="You already have an organization request waiting for review."
          kind="error"
        />
      ) : null}
      {query.notice === "organization-pending" ? (
        <DashboardNotice
          message="Your request was submitted. You can use the workspace after it is approved."
          kind="info"
        />
      ) : null}
      {requests.length ? (
        <section className="dashboard-card organization-request-history">
          <div className="dashboard-card-heading">
            <div>
              <h2>Your organization requests</h2>
              <p>Pending requests are not available in the organization switcher.</p>
            </div>
          </div>
          <div className="record-list">
            {requests.map((request) => (
              <article className="record-item" key={request.organization.organizationId}>
                <div className="record-item-head">
                  <div>
                    <strong>{request.organization.name}</strong>
                    <span className="record-meta">
                      Submitted {new Date(request.organization.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <span
                    className={`record-badge ${request.status === "pending" ? "pending" : "rejected"}`}
                  >
                    {request.status}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {!current.subject.emailVerifiedAt ? (
        <DashboardNotice
          message="Verify your email before creating an organization."
          kind="error"
        />
      ) : requests.some((request) => request.status === "pending") ? (
        <section className="dashboard-card new-organization-card">
          <h2>Request under review</h2>
          <p className="form-hint">
            Wait for this request to be approved or rejected before submitting another one.
          </p>
        </section>
      ) : (
        <section className="dashboard-card new-organization-card">
          <form action={createOrganizationAction} className="auth-form">
            <input type="hidden" name="returnTo" value="/dashboard/new-organization" />
            <label>
              Organization name
              <input name="name" required minLength={2} maxLength={80} placeholder="Acme Studio" />
            </label>
            <p className="form-hint">
              You’ll become the Owner if approved. The workspace stays unavailable until then.
            </p>
            <button className="button button-primary" type="submit">
              Submit for approval
            </button>
          </form>
        </section>
      )}
    </DashboardShell>
  );
}
