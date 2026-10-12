import { cache } from "react";
import type { OrganizationActivityEntry, PlatformActivityEntry } from "@/lib/auth/service";

type ActivityFeedEntry = OrganizationActivityEntry &
  Partial<Pick<PlatformActivityEntry, "organization" | "user" | "actorIsUser">>;

const ACTIVITY_TIME_UNITS: readonly {
  seconds: number;
  unit: Intl.RelativeTimeFormatUnit;
}[] = [
  { seconds: 31_536_000, unit: "year" },
  { seconds: 2_592_000, unit: "month" },
  { seconds: 604_800, unit: "week" },
  { seconds: 86_400, unit: "day" },
  { seconds: 3_600, unit: "hour" },
  { seconds: 60, unit: "minute" },
  { seconds: 1, unit: "second" },
];
const requestTime = cache(() => Date.now());

function relativeActivityTime(occurredAt: string, now: number): string {
  const differenceInSeconds = Math.round((Date.parse(occurredAt) - now) / 1000);
  const timeUnit =
    ACTIVITY_TIME_UNITS.find(({ seconds }) => Math.abs(differenceInSeconds) >= seconds) ??
    ACTIVITY_TIME_UNITS.at(-1)!;

  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round(differenceInSeconds / timeUnit.seconds),
    timeUnit.unit,
  );
}

function actionText(summary: string): string {
  return summary ? summary[0].toLowerCase() + summary.slice(1) : summary;
}

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
        {entries.map((entry) => {
          const hasPlatformContext = showPlatformContext && entry.organization !== undefined;
          const actorIsUser = hasPlatformContext && entry.actorIsUser === true;
          const actorIsAffectedUser =
            entry.affectedUser !== null &&
            (entry.actor === entry.affectedUser ||
              (actorIsUser && entry.user === entry.affectedUser));
          const showPersonChip =
            !hasPlatformContext && entry.affectedUser !== null && !actorIsAffectedUser;
          const showUserChip =
            hasPlatformContext && entry.user != null && !actorIsUser && entry.user !== entry.actor;
          const personOrUserIsTarget =
            entry.affectedUser !== null &&
            entry.target === entry.affectedUser &&
            (showPersonChip || showUserChip || actorIsAffectedUser);
          const platformUserIsTarget =
            hasPlatformContext &&
            entry.user != null &&
            entry.target === entry.user &&
            (showUserChip || actorIsUser || entry.user === entry.actor);
          const showTargetChip =
            entry.target !== entry.actor && !personOrUserIsTarget && !platformUserIsTarget;
          const details = entry.details.filter(
            (detail) => detail.label.toLowerCase() !== "event type",
          );
          const exactTime = new Date(entry.occurredAt).toLocaleString();

          return (
            <li className="activity-item" key={entry.eventId}>
              <div className="activity-item-content">
                <div className="activity-item-header">
                  <div className="activity-item-heading">
                    <p className="activity-summary">
                      <strong>{entry.actor}</strong> {actionText(entry.summary)}.
                    </p>
                    {showPersonChip ? (
                      <span className="activity-target-chip">
                        <span className="activity-target-label">Person:</span>
                        <span className="activity-target-value">{entry.affectedUser}</span>
                      </span>
                    ) : null}
                    {showUserChip ? (
                      <span className="activity-target-chip">
                        <span className="activity-target-label">User:</span>
                        <span className="activity-target-value">{entry.user}</span>
                      </span>
                    ) : null}
                    {showTargetChip ? (
                      <span className="activity-target-chip">
                        <span className="activity-target-label">Target:</span>
                        <span className="activity-target-value">{entry.target}</span>
                      </span>
                    ) : null}
                  </div>
                  <time className="activity-time" dateTime={entry.occurredAt}>
                    <span className="activity-time-relative">
                      {relativeActivityTime(entry.occurredAt, now)}
                    </span>{" "}
                    <span className="activity-time-exact">{exactTime}</span>
                  </time>
                </div>
                {hasPlatformContext ? (
                  <div className="activity-context">
                    <span className="activity-context-chip">
                      Organization: {entry.organization}
                    </span>
                  </div>
                ) : null}
                {details.length ? (
                  <div className="activity-details">
                    {details.map((detail, index) => (
                      <p className="activity-detail-row" key={index}>
                        <span className="activity-detail-label">{detail.label}: </span>
                        {detail.before !== undefined && detail.after !== undefined ? (
                          <>
                            {detail.before} <span aria-hidden="true">→</span> {detail.after}
                          </>
                        ) : (
                          detail.value
                        )}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
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
