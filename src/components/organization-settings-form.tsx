export function OrganizationSettingsForm({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  return (
    <section className="dashboard-card settings-card">
      <form action="/actions/updateOrganizationNameAction" method="post" className="auth-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <label>
          Organization name
          <input
            name="name"
            defaultValue={organizationName}
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
  );
}
