import Link from "next/link";
import {
  retireLegacyAccessAction,
  reviewOrganizationRequestAction,
  updateAccountStatusAction,
} from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import {
  getCurrentSession,
  isAdministrator,
  listAccountsForAdministrator,
  listPendingOrganizationsForAdministrator,
  listPlatformAudit,
  previewLegacyAccessRetirement,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; retired?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");
  const [accounts, organizations, legacy, activity, query] = await Promise.all([
    listAccountsForAdministrator(current.subject.subjectId),
    listPendingOrganizationsForAdministrator(current.subject.subjectId),
    previewLegacyAccessRetirement(current.subject.subjectId),
    listPlatformAudit(current.subject.subjectId),
    searchParams,
  ]);
  return (
    <>
      <SiteHeader active="dashboard" authenticated />
      <main className="page-shell operations-page-shell">
        <div className="container operations-page">
          <header className="operations-topline">
            <Link href="/dashboard">← Back to dashboard</Link>
          </header>
          <DashboardHeading
            eyebrow="Restricted tools"
            title="Platform operations"
            description="Review organization requests, support accounts, and retire unscoped legacy access."
          />
          {query.error === "migration" ? (
            <DashboardNotice
              message="Legacy access could not be retired. Check storage and retry."
              kind="error"
            />
          ) : null}
          {query.retired ? (
            <DashboardNotice
              message={`Migration complete: disabled ${query.retired.split(",")[0]} unscoped grants and revoked ${query.retired.split(",")[1] ?? 0} unscoped keys.`}
              kind="success"
            />
          ) : null}
          {query.notice === "account-updated" ? (
            <DashboardNotice message="Account status updated." kind="success" />
          ) : null}
          {query.error === "organization-review" ? (
            <DashboardNotice
              message="That organization request could not be reviewed. It may already have a decision."
              kind="error"
            />
          ) : null}
          {query.notice === "organization-approved" ? (
            <DashboardNotice message="Organization approved." kind="success" />
          ) : null}
          {query.notice === "organization-rejected" ? (
            <DashboardNotice message="Organization request rejected." kind="success" />
          ) : null}
          <section className="dashboard-card operations-organizations">
            <div className="dashboard-card-heading">
              <div>
                <h2>Organization requests</h2>
                <p>{organizations.length} waiting for review</p>
              </div>
            </div>
            {organizations.length ? (
              <div className="record-list">
                {organizations.map((organization) => (
                  <article className="record-item" key={organization.organizationId}>
                    <div className="record-item-head">
                      <div>
                        <strong>{organization.name}</strong>
                        <span className="record-meta">
                          {organization.requesterEmail ?? "Requester email unavailable"} · Submitted{" "}
                          {new Date(organization.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <span className="record-badge pending">Pending</span>
                    </div>
                    <div className="record-actions">
                      <form action={reviewOrganizationRequestAction}>
                        <input
                          type="hidden"
                          name="organizationId"
                          value={organization.organizationId}
                        />
                        <input type="hidden" name="approvalStatus" value="approved" />
                        <button className="button button-primary" type="submit">
                          Approve
                        </button>
                      </form>
                      <form action={reviewOrganizationRequestAction}>
                        <input
                          type="hidden"
                          name="organizationId"
                          value={organization.organizationId}
                        />
                        <input type="hidden" name="approvalStatus" value="rejected" />
                        <button className="button button-secondary" type="submit">
                          Reject
                        </button>
                      </form>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-list">No organization requests are waiting for review.</p>
            )}
          </section>
          <section className="dashboard-card operations-migration">
            <div>
              <h2>Retire legacy access</h2>
              <p>
                This disables grants and revokes API keys that do not belong to an organization.
                Identities, sessions, and audit history are preserved. The operation is safe to
                repeat.
              </p>
            </div>
            <div className="migration-counts">
              <span>
                <strong>{legacy.grants}</strong> active grants
              </span>
              <span>
                <strong>{legacy.keys}</strong> active API keys
              </span>
            </div>
            {legacy.grants || legacy.keys ? (
              <form action={retireLegacyAccessAction}>
                <button className="button button-primary" type="submit">
                  Disable legacy access
                </button>
              </form>
            ) : (
              <p className="form-hint">No active unscoped grants or keys remain.</p>
            )}
          </section>
          <section className="dashboard-card operations-accounts">
            <div className="dashboard-card-heading">
              <div>
                <h2>Accounts</h2>
                <p>{accounts.length} registered accounts</p>
              </div>
            </div>
            <div className="record-list">
              {accounts.map((account) => (
                <article className="record-item admin-account-row" key={account.subjectId}>
                  <p>
                    {account.email ?? "No email"}
                    <span>
                      {account.status} · {account.emailVerified ? "verified" : "not verified"}
                      {account.administrator ? " · platform administrator" : ""}
                    </span>
                  </p>
                  {!account.administrator ? (
                    <form action={updateAccountStatusAction}>
                      <input type="hidden" name="subjectId" value={account.subjectId} />
                      <input
                        type="hidden"
                        name="status"
                        value={account.status === "active" ? "disabled" : "active"}
                      />
                      <button className="button button-secondary" type="submit">
                        {account.status === "active" ? "Disable account" : "Enable account"}
                      </button>
                    </form>
                  ) : (
                    <span className="record-badge active">Restricted admin</span>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section className="dashboard-card platform-activity">
            <div className="dashboard-card-heading">
              <div>
                <h2>Historical activity</h2>
                <p>Recent events across Perminister, including legacy access history.</p>
              </div>
            </div>
            {activity.length ? (
              <ol className="activity-list">
                {activity.map((entry) => (
                  <li key={entry.eventId}>
                    <span className="activity-mark" aria-hidden="true" />
                    <div>
                      <strong>{entry.type.replaceAll(".", " · ").replaceAll("-", " ")}</strong>
                      <span>
                        {entry.actor} · {entry.aggregateKind}
                      </span>
                    </div>
                    <time dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-list">No recorded activity.</p>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
