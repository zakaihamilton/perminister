import type { OrganizationActivityEntry, PlatformActivityEntry } from "@/lib/auth/service";

type ActivityFeedEntry = OrganizationActivityEntry &
  Partial<Pick<PlatformActivityEntry, "organization" | "user" | "actorIsUser">>;

export function ActivityFeed({
  entries,
  emptyMessage,
  showPlatformContext = false,
  title,
  description,
}: {
  entries: readonly ActivityFeedEntry[];
  emptyMessage: string;
  showPlatformContext?: boolean;
  title?: string;
  description?: string;
}) {
  return entries.length ? (
    <section className="dashboard-card activity-card">
      {title ? (
        <div className="dashboard-card-heading">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
        </div>
      ) : null}
      <ol className="activity-list">
        {entries.map((entry) => (
          <li key={entry.eventId}>
            <span className="activity-mark" aria-hidden="true" />
            <div>
              <strong>{entry.type.replaceAll(".", " · ").replaceAll("-", " ")}</strong>
              {showPlatformContext &&
              entry.organization !== undefined &&
              entry.user !== undefined ? (
                <>
                  <span>Organization: {entry.organization}</span>
                  {entry.user ? <span>User: {entry.user}</span> : null}
                  {entry.actorIsUser === false ||
                  (entry.actorIsUser === undefined && entry.actor !== entry.user) ? (
                    <span>Actor: {entry.actor}</span>
                  ) : null}
                </>
              ) : (
                <span>
                  {entry.actor} · {entry.aggregateKind}
                </span>
              )}
            </div>
            <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
          </li>
        ))}
      </ol>
    </section>
  ) : (
    <section className="dashboard-empty-card">
      <div>
        <h2>{title ?? "No activity yet"}</h2>
        {description ? <p>{description}</p> : null}
        <p>{emptyMessage}</p>
      </div>
    </section>
  );
}
