import { updateOrganizationNameAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { getCurrentSession, getOrganizationForSubject } from "@/lib/auth/service";
import { notFound, redirect } from "next/navigation";

export default async function OrganizationSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [current, { organizationId }, query] = await Promise.all([
    getCurrentSession(),
    params,
    searchParams,
  ]);
  if (!current) redirect("/login");
  const summary = await getOrganizationForSubject(current.subject.subjectId, organizationId);
  if (summary.membership.role !== "owner") notFound();
  return (
    <>
      <DashboardHeading description="Update the name shown to members and in invitations." />
      {query.notice === "settings-saved" ? (
        <DashboardNotice message="Organization settings saved." kind="success" />
      ) : null}
      {query.error ? (
        <DashboardNotice
          message="Settings could not be saved. Check the organization name and try again."
          kind="error"
        />
      ) : null}
      <section className="dashboard-card settings-card">
        <form action={updateOrganizationNameAction} className="auth-form">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label>
            Organization name
            <input
              name="name"
              defaultValue={summary.organization.name}
              required
              minLength={2}
              maxLength={80}
            />
          </label>
          <p className="form-hint">Only owners can change organization settings.</p>
          <button className="button button-primary" type="submit">
            Save changes
          </button>
        </form>
      </section>
    </>
  );
}
