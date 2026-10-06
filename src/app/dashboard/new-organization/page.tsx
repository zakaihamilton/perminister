import Link from "next/link";
import { createOrganizationAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice, DashboardShell } from "@/components/dashboard-shell";
import { getCurrentSession, listOrganizationsForSubject } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function NewOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [organizations, query] = await Promise.all([
    listOrganizationsForSubject(current.subject.subjectId),
    searchParams,
  ]);
  if (!organizations.length) redirect("/dashboard");
  const selected = organizations[0];
  return (
    <DashboardShell
      organizationId={selected.organization.organizationId}
      organizations={organizations}
      role={selected.membership.role}
      email={current.subject.primaryEmail}
    >
      <DashboardHeading eyebrow="Workspace" title="Create an organization" description="Create a separate organization for another team or set of products." action={<Link className="button button-secondary" href={`/dashboard/${selected.organization.organizationId}`}>Cancel</Link>} />
      {query.error === "organization-create" ? <DashboardNotice message="Your organization could not be created. Verify your email and try again." kind="error" /> : null}
      {!current.subject.emailVerifiedAt ? <DashboardNotice message="Verify your email before creating an organization." kind="error" /> : <section className="dashboard-card new-organization-card">
        <form action={createOrganizationAction} className="auth-form">
          <input type="hidden" name="returnTo" value="/dashboard/new-organization" />
          <label>Organization name<input name="name" required minLength={2} maxLength={80} placeholder="Acme Studio" /></label>
          <p className="form-hint">You’ll become the Owner and can invite teammates after setup.</p>
          <button className="button button-primary" type="submit">Create organization</button>
        </form>
      </section>}
    </DashboardShell>
  );
}
