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
          {entries.slice(0, 4).map((entry) => (
            <li className="organization-activity-item" key={entry.eventId}>
              <span className="organization-activity-marker" aria-hidden="true" />
              <div>
                <p>
                  <strong>{entry.actor}</strong> {lowercaseFirst(entry.summary)}.
                </p>
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
          ))}
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

function lowercaseFirst(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function ActivityMetricIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />
    </svg>
  );
}
