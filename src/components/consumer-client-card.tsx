import Link from "next/link";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import type { ConsumerClientManagementAction } from "@/components/consumer-client-list-types";

const createdDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function sessionLifetimeLabel(milliseconds: number): string {
  const hours = milliseconds / (60 * 60 * 1000);
  if (hours % 24 === 0) {
    const days = hours / 24;
    const dayLabel = days === 1 ? "day" : "days";
    const hourLabel = hours === 1 ? "hour" : "hours";
    return `${days} ${dayLabel} (${hours} ${hourLabel})`;
  }
  if (Number.isInteger(hours)) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const minutes = milliseconds / (60 * 1000);
  if (Number.isInteger(minutes) && minutes < 60) {
    const roundedHours = Number(hours.toFixed(2));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} (${roundedHours} hours)`;
  }
  return `${Number(hours.toFixed(2))} hours`;
}

export function ConsumerClientCard({
  client,
  onRequestConfirmation,
  readOnly,
  returnTo,
}: {
  client: ConsumerClientSummary;
  onRequestConfirmation: (
    action: ConsumerClientManagementAction,
    client: ConsumerClientSummary,
  ) => void;
  readOnly: boolean;
  returnTo: string;
}) {
  return (
    <article className="consumer-client-card">
      <div className="consumer-client-card-heading">
        <div>
          <h3>{client.appName}</h3>
          <p>
            Client ID <code>{client.clientId}</code>
          </p>
        </div>
        <span className={`record-badge ${client.status}`}>
          {client.status === "active" ? "Active" : "Revoked"}
        </span>
      </div>
      <dl className="consumer-client-details-grid">
        <div>
          <dt>Allowed origin</dt>
          <dd>{client.appOrigin ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Session lifetime</dt>
          <dd>{sessionLifetimeLabel(client.sessionLifetimeMs)}</dd>
        </div>
        <div>
          <dt>People can sign up</dt>
          <dd>{client.selfRegistrationEnabled ? "Enabled" : "Disabled"}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <time dateTime={client.createdAt}>
              {createdDateFormatter.format(new Date(client.createdAt))}
            </time>
          </dd>
        </div>
      </dl>
      {!readOnly && client.status === "active" ? (
        <div className="consumer-client-card-actions">
          <div className="consumer-client-card-buttons">
            <Link
              className="button button-secondary"
              href={`${returnTo}/${encodeURIComponent(client.clientId)}/edit`}
            >
              Edit settings
            </Link>
            <button
              aria-haspopup="dialog"
              className="button button-secondary"
              onClick={() => onRequestConfirmation("rotate", client)}
              type="button"
            >
              Rotate secret
            </button>
            <button
              aria-haspopup="dialog"
              className="button button-danger"
              onClick={() => onRequestConfirmation("revoke", client)}
              type="button"
            >
              Revoke app client
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
