import type { OrganizationActivityEntry } from "@/lib/auth/service";

export function ActivityFeed({
  entries,
  emptyMessage,
}: {
  entries: readonly OrganizationActivityEntry[];
  emptyMessage: string;
}) {
  return entries.length ? (
    <section className="dashboard-card activity-card">
      <ol className="activity-list">
        {entries.map((entry) => (
          <li key={entry.eventId}>
            <span className="activity-mark" aria-hidden="true" />
            <div>
              <strong>{entry.type.replaceAll(".", " · ").replaceAll("-", " ")}</strong>
              <span>
                {entry.actor} · {entry.aggregateKind}
              </span>
            </div>
            <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
          </li>
        ))}
      </ol>
    </section>
  ) : (
    <section className="dashboard-empty-card">
      <div>
        <h2>No activity yet</h2>
        <p>{emptyMessage}</p>
      </div>
    </section>
  );
}
