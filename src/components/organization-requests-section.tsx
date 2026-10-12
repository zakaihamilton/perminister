import { reviewOrganizationRequestAction } from "@/app/actions";
import type { OrganizationReviewRequest } from "@/lib/auth/service";

export function OrganizationRequestsSection({
  organizations,
}: {
  organizations: OrganizationReviewRequest[];
}) {
  return (
    <section className="dashboard-card operations-organizations">
      <div className="dashboard-card-heading">
        <div>
          <h2>Organization requests</h2>
          <p>{organizations.length} waiting for review</p>
        </div>
      </div>
      {organizations.length ? (
        <div className="record-list">
          {organizations.map((organization) => (
            <article className="record-item" key={organization.organizationId}>
              <div className="record-item-head">
                <div>
                  <strong>{organization.name}</strong>
                  <span className="record-meta">
                    {organization.requesterEmail ?? "Requester email unavailable"} · Submitted{" "}
                    {new Date(organization.createdAt).toLocaleString()}
                  </span>
                </div>
                <span className="record-badge pending">Pending</span>
              </div>
              <div className="record-actions">
                <form action={reviewOrganizationRequestAction}>
                  <input type="hidden" name="organizationId" value={organization.organizationId} />
                  <input type="hidden" name="approvalStatus" value="approved" />
                  <button className="button button-primary" type="submit">
                    Approve
                  </button>
                </form>
                <form action={reviewOrganizationRequestAction}>
                  <input type="hidden" name="organizationId" value={organization.organizationId} />
                  <input type="hidden" name="approvalStatus" value="rejected" />
                  <button className="button button-secondary" type="submit">
                    Reject
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-list">No organization requests are waiting for review.</p>
      )}
    </section>
  );
}
