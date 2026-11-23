import Link from "next/link";
import type { OrganizationActivityEntry } from "@/lib/auth/service";

export function OrganizationActivityPreview({
  entries,
  organizationId,
}: {
  entries: OrganizationActivityEntry[];
  organizationId: string;
}) {
  return (
    <section className="dashboard-card organization-activity-preview">
      <div className="dashboard-card-heading organization-activity-heading">
        <div>
          <h2>Recent activity</h2>
          <p>Changes to members, products, access, and API keys.</p>
        </div>
        <Link className="text-link" href={`/dashboard/${organizationId}/activity`}>
          View all
        </Link>
      </div>
      {entries.length ? (
        <ol className="organization-activity-list">
          {entries.slice(0, 4).map((entry) => {
            const details = entry.details
              .filter((detail) => detail.label.toLowerCase() !== "event type")
              .slice(0, 2);
            const showPerson = entry.affectedUser !== null && entry.affectedUser !== entry.actor;
            const personIsTarget =
              entry.affectedUser !== null && entry.target === entry.affectedUser && showPerson;
            const showTarget = entry.target !== entry.actor && !personIsTarget;

            return (
              <li className="organization-activity-item" key={entry.eventId}>
                <span className="organization-activity-marker" aria-hidden="true" />
                <div className="organization-activity-copy">
                  <p className="organization-activity-summary">
                    <strong>{entry.actor}</strong> {lowercaseFirst(entry.summary)}.
                  </p>
                  {showPerson || showTarget || details.length > 0 ? (
                    <div className="organization-activity-metadata">
                      {showPerson ? (
                        <ActivityMetadata label="Person" value={entry.affectedUser!} />
                      ) : null}
                      {showTarget ? (
                        <ActivityMetadata label="Target" value={entry.target} />
                      ) : null}
                      {details.map((detail, index) => (
                        <span
                          className="organization-activity-meta-item"
                          key={`${detail.label}-${index}`}
                        >
                          <span className="organization-activity-meta-label">{detail.label}</span>
                          <span className="organization-activity-meta-value">
                            {detail.before !== undefined && detail.after !== undefined ? (
                              <>
                                {detail.before} <span aria-hidden="true">→</span> {detail.after}
                              </>
                            ) : (
                              detail.value
                            )}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <time
                    dateTime={entry.occurredAt}
                    title={new Date(entry.occurredAt).toLocaleString()}
                  >
                    {new Intl.DateTimeFormat("en", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(entry.occurredAt))}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="organization-activity-empty">
          <span className="organization-activity-empty-icon" aria-hidden="true">
            <ActivityMetricIcon />
          </span>
          <strong>No activity yet</strong>
          <p>Organization changes will appear here.</p>
        </div>
      )}
    </section>
  );
}

function ActivityMetadata({ label, value }: { label: string; value: string }) {
  return (
    <span className="organization-activity-meta-item">
      <span className="organization-activity-meta-label">{label}</span>
      <span className="organization-activity-meta-value">{value}</span>
    </span>
  );
}

function lowercaseFirst(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function ActivityMetricIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />
    </svg>
  );
}
