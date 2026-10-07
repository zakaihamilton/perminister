import { DashboardHeading } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getProductAccessForSubject,
  listProductAudit,
} from "@/lib/auth/service";
import { notFound, redirect } from "next/navigation";

export default async function ProductActivityPage({
  params,
}: {
  params: Promise<{ organizationId: string; productId: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const { organizationId, productId } = await params;
  const access = await getProductAccessForSubject(current.subject.subjectId, organizationId, productId).catch(() => null);
  if (!access || !access.membership) notFound();
  const entries = await listProductAudit(current.subject.subjectId, organizationId, productId);
  return (
    <>
      <DashboardHeading eyebrow={access.product.name} title="Activity" description="Recent membership, invitation, grant, and key changes for this product." />
      {entries.length ? (
        <section className="dashboard-card activity-card">
          <ol className="activity-list">
            {entries.map((entry) => (
              <li key={entry.eventId}>
                <span className="activity-mark" aria-hidden="true" />
                <div><strong>{entry.type.replaceAll(".", " · ").replaceAll("-", " ")}</strong><span>{entry.actor} · {entry.aggregateKind}</span></div>
                <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="dashboard-empty-card"><div><h2>No activity yet</h2><p>Product changes will appear here.</p></div></section>
      )}
    </>
  );
}
