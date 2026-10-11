import type { OrganizationRequestSummary } from "@/lib/auth/service";

export function OrganizationRequestHistoryRecord({
  request,
  statusLabel = request.status,
}: {
  request: OrganizationRequestSummary;
  statusLabel?: string;
}) {
  return (
    <article className="record-item">
      <div className="record-item-head">
        <div>
          <strong>{request.organization.name}</strong>
          <span className="record-meta">
            Submitted {new Date(request.organization.createdAt).toLocaleString()}
          </span>
        </div>
        <span className={`record-badge ${request.status}`}>{statusLabel}</span>
      </div>
    </article>
  );
}
