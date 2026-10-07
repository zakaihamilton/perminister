import { DashboardHeading } from "@/components/dashboard-shell";
import { getProductPageContext, type ProductPageParams } from "@/lib/auth/product-page-context";
import { listProductAudit } from "@/lib/auth/service";
import { notFound } from "next/navigation";

export default async function ProductActivityPage({ params }: ProductPageParams) {
  const { current, organizationId, productId, access } = await getProductPageContext(params);
  if (!access.membership) notFound();
  const entries = await listProductAudit(current.subject.subjectId, organizationId, productId);
  return (
    <>
      <DashboardHeading description="Recent membership, invitation, grant, and key changes for this product." />
      {entries.length ? (
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
                <time dateTime={entry.occurredAt}>
                  {new Date(entry.occurredAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="dashboard-empty-card">
          <div>
            <h2>No activity yet</h2>
            <p>Product changes will appear here.</p>
          </div>
        </section>
      )}
    </>
  );
}
