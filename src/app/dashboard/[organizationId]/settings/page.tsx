import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { getOrganizationForSubject } from "@/lib/auth/service";
import { notFound } from "next/navigation";
import {
  getOrganizationDashboardRequestContext,
  type OrganizationDashboardPageProps,
} from "@/lib/auth/organization-dashboard-context";

export default async function OrganizationSettingsPage(
  props: OrganizationDashboardPageProps<{ notice?: string; error?: string }>,
) {
  const { current, organizationId, query } = await getOrganizationDashboardRequestContext(props);
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
        <form action="/actions/updateOrganizationNameAction" method="post" className="auth-form">
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
