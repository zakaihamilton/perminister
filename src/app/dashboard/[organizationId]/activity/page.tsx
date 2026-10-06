import { DashboardHeading } from "@/components/dashboard-shell";
import { getCurrentSession, getOrganizationForSubject, listOrganizationAudit } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ActivityPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const [current, { organizationId }] = await Promise.all([getCurrentSession(), params]);
  if (!current) redirect("/login");
  const organization = await getOrganizationForSubject(current.subject.subjectId, organizationId);
  if (organization.membership.role === "member") redirect(`/dashboard/${organizationId}`);
  const entries = await listOrganizationAudit(current.subject.subjectId, organizationId);
  return (
    <>
      <DashboardHeading eyebrow="Workspace" title="Activity" description="Recent changes to organization membership, products, grants, and keys." />
      {entries.length ? <section className="dashboard-card activity-card"><ol className="activity-list">{entries.map((entry) => <li key={entry.eventId}>
        <span className="activity-mark" aria-hidden="true" />
        <div><strong>{entry.type.replaceAll(".", " · ").replaceAll("-", " ")}</strong><span>{entry.actor} · {entry.aggregateKind}</span></div>
        <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
      </li>)}</ol></section> : <section className="dashboard-empty-card"><div><h2>No activity yet</h2><p>Organization changes will appear here.</p></div></section>}
    </>
  );
}
