import Link from "next/link";
import { retireLegacyAccessAction, updateAccountStatusAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import {
  getCurrentSession,
  isAdministrator,
  listAccountsForAdministrator,
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
  const [accounts, legacy, activity, query] = await Promise.all([
    listAccountsForAdministrator(current.subject.subjectId),
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
            description="Account support and one-time retirement of unscoped legacy access."
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
