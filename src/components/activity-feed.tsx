import { cache } from "react";
import { ActivityFeedEntryRow, type ActivityFeedEntry } from "@/components/activity-feed-entry";

const requestTime = cache(() => Date.now());

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
  const now = requestTime();

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
          <ActivityFeedEntryRow
            entry={entry}
            key={entry.eventId}
            now={now}
            showPlatformContext={showPlatformContext}
          />
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
