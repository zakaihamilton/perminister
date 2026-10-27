import type { SessionRecord } from "@/lib/auth/domain";

export function SessionList({
  sessions,
  currentSessionId,
  returnTo,
}: {
  sessions: SessionRecord[];
  currentSessionId: string;
  returnTo: string;
}) {
  return (
    <>
      {sessions.length ? (
        <div className="record-list">
          {sessions.map((session) => (
            <article className="record-item" key={session.sessionId}>
              <div className="record-item-head">
                <div>
                  <strong>
                    {session.sessionId === currentSessionId
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
                <form action="/actions/revokeSessionAction" method="post">
                  <input type="hidden" name="sessionId" value={session.sessionId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button className="button button-secondary" type="submit">
                    {session.sessionId === currentSessionId
                      ? "Sign out this device"
                      : "Sign out device"}
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="dashboard-empty-card">
          <div>
            <h2>No signed-in devices</h2>
            <p>Your account is not signed in on any devices.</p>
          </div>
        </section>
      )}
    </>
  );
}
