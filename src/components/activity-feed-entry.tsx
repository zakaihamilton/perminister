import type { OrganizationActivityEntry, PlatformActivityEntry } from "@/lib/auth/service";

export type ActivityFeedEntry = OrganizationActivityEntry &
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

function ActivityTargetChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="activity-target-chip">
      <span className="activity-target-label">{label}:</span>
      <span className="activity-target-value">{value}</span>
    </span>
  );
}

function ActivityDetailRows({ details }: { details: ActivityFeedEntry["details"] }) {
  const visibleDetails = details.filter((detail) => detail.label.toLowerCase() !== "event type");
  if (!visibleDetails.length) return null;

  return (
    <div className="activity-details">
      {visibleDetails.map((detail, index) => (
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
  );
}

export function ActivityFeedEntryRow({
  entry,
  now,
  showPlatformContext,
}: {
  entry: ActivityFeedEntry;
  now: number;
  showPlatformContext: boolean;
}) {
  const hasPlatformContext = showPlatformContext && entry.organization !== undefined;
  return (
    <li className="activity-item">
      <div className="activity-item-content">
        <ActivityEntryHeading entry={entry} hasPlatformContext={hasPlatformContext} now={now} />
        {hasPlatformContext ? (
          <div className="activity-context">
            <span className="activity-context-chip">Organization: {entry.organization}</span>
          </div>
        ) : null}
        <ActivityDetailRows details={entry.details} />
      </div>
    </li>
  );
}

function ActivityEntryHeading({
  entry,
  hasPlatformContext,
  now,
}: {
  entry: ActivityFeedEntry;
  hasPlatformContext: boolean;
  now: number;
}) {
  const actorIsUser = hasPlatformContext && entry.actorIsUser === true;
  const actorIsAffectedUser =
    entry.affectedUser !== null &&
    (entry.actor === entry.affectedUser || (actorIsUser && entry.user === entry.affectedUser));
  const showPersonChip = !hasPlatformContext && entry.affectedUser !== null && !actorIsAffectedUser;
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
  const exactTime = new Date(entry.occurredAt).toLocaleString();

  return (
    <div className="activity-item-header">
      <div className="activity-item-heading">
        <p className="activity-summary">
          <strong>{entry.actor}</strong> {actionText(entry.summary)}.
        </p>
        {showPersonChip ? <ActivityTargetChip label="Person" value={entry.affectedUser!} /> : null}
        {showUserChip ? <ActivityTargetChip label="User" value={entry.user!} /> : null}
        {showTargetChip ? <ActivityTargetChip label="Target" value={entry.target} /> : null}
      </div>
      <time className="activity-time" dateTime={entry.occurredAt}>
        <span className="activity-time-relative">
          {relativeActivityTime(entry.occurredAt, now)}
        </span>{" "}
        <span className="activity-time-exact">{exactTime}</span>
      </time>
    </div>
  );
}
