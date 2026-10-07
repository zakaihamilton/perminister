import { revokeSessionAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { getCurrentSession, listSessionsForSubject } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [current, { organizationId }, query] = await Promise.all([
    getCurrentSession(),
    params,
    searchParams,
  ]);
  if (!current) redirect("/login");
  const sessions = await listSessionsForSubject(current.subject.subjectId);
  const returnTo = `/dashboard/${organizationId}/sessions`;
  return (
    <>
      <DashboardHeading
        eyebrow="Your account"
        title="Sessions"
        description="Review and revoke the devices signed in to your account."
      />
      {query.notice === "session-revoked" ? (
        <DashboardNotice message="Session revoked." kind="success" />
      ) : null}
      {query.notice === "session-revoke-failed" ? (
        <DashboardNotice message="That session could not be revoked." kind="error" />
      ) : null}
      {sessions.length ? (
        <div className="record-list">
          {sessions.map((session) => (
            <article className="record-item" key={session.sessionId}>
              <div className="record-item-head">
                <div>
                  <strong>
                    {session.sessionId === current.session.sessionId
                      ? "This device"
                      : session.applicationClientId
                        ? `${session.applicationClientId} app session`
                        : "Signed-in device"}
                  </strong>
                  <span className="record-meta">
                    Signed in {new Date(session.createdAt).toLocaleString()}
                  </span>
                  <span className="record-meta">
                    Expires {new Date(session.expiresAt).toLocaleString()}
                  </span>
                </div>
                <span className="record-badge active">Active</span>
              </div>
              <div className="record-actions">
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.sessionId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button className="button button-secondary" type="submit">
                    {session.sessionId === current.session.sessionId
                      ? "Sign out this device"
                      : "Revoke session"}
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="dashboard-empty-card">
          <div>
            <h2>No active sessions</h2>
            <p>Sign in again to create a session.</p>
          </div>
        </section>
      )}
    </>
  );
}
