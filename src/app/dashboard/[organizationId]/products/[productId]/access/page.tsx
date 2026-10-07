import { createGrantAction, updateGrantStatusAction } from "@/app/actions";
import { CustomDropdown } from "@/components/custom-dropdown";
import { Tooltip } from "@/components/tooltip";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getProductAccessForSubject,
  listProductMembers,
  listProductPermissionGrants,
} from "@/lib/auth/service";
import type { MembershipRecord, ResourceScope } from "@/lib/auth/domain";
import { notFound, redirect } from "next/navigation";

function scopeLabel(scope: ResourceScope): string {
  if (scope.kind === "product") return "Entire product";
  if (scope.kind === "project") return `Project ${scope.projectId}`;
  return `Workspace ${scope.workspaceId}`;
}

function GrantCard({
  grant,
  email,
  canManage,
  organizationId,
  productId,
}: {
  grant: MembershipRecord;
  email: string | null;
  canManage: boolean;
  organizationId: string;
  productId: string;
}) {
  return (
    <article className="access-grant-card">
      <div className="access-grant-main">
        <div>
          <strong>{email ?? "Product member"}</strong>
          <span>{scopeLabel(grant.scope)}</span>
          <small>{grant.grants.flatMap((item) => item.actions).join(", ")}</small>
        </div>
        <span className={`record-badge ${grant.status}`}>{grant.status}</span>
      </div>
      {canManage ? (
        <form action={updateGrantStatusAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="membershipId" value={grant.membershipId} />
          <input
            type="hidden"
            name="status"
            value={grant.status === "active" ? "disabled" : "active"}
          />
          <button className="button button-secondary" type="submit">
            {grant.status === "active" ? "Revoke access" : "Restore access"}
          </button>
        </form>
      ) : null}
    </article>
  );
}

export default async function ProductAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; productId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId, productId }, query] = await Promise.all([params, searchParams]);
  const access = await getProductAccessForSubject(
    current.subject.subjectId,
    organizationId,
    productId,
  ).catch(() => null);
  if (!access) notFound();
  const role = access.membership?.role;
  if (!role) redirect(`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}`);
  const canManage = role === "owner" || role === "admin";
  const [grants, members] = await Promise.all([
    listProductPermissionGrants(current.subject.subjectId, organizationId, productId),
    canManage
      ? listProductMembers(current.subject.subjectId, organizationId, productId)
      : Promise.resolve([]),
  ]);
  const emailBySubject = new Map(
    members.map((member) => [member.membership.subjectId, member.email]),
  );
  if (!canManage) emailBySubject.set(current.subject.subjectId, current.subject.primaryEmail);
  const eligibleMembers = members.filter(
    (member) => member.emailVerified && member.membership.status === "active",
  );

  return (
    <>
      <DashboardHeading
        eyebrow={access.product.name}
        title="Access"
        description={
          canManage
            ? "Grant explicit API actions to members of this product."
            : "Review the API actions assigned to you in this product."
        }
      />
      {query.notice === "grant-created" ? (
        <DashboardNotice message="Access grant created." kind="success" />
      ) : null}
      {query.notice === "grant-updated" ? (
        <DashboardNotice message="Access grant updated." kind="success" />
      ) : null}
      {query.error === "grant-failed" ? (
        <DashboardNotice
          message="That access change could not be completed. Check the member, scope, and action names."
          kind="error"
        />
      ) : null}

      {grants.length ? (
        <div className="access-grant-list">
          {grants.map((grant) => (
            <GrantCard
              key={grant.membershipId}
              grant={grant}
              email={
                emailBySubject.get(grant.subjectId) ??
                (grant.subjectId === current.subject.subjectId
                  ? current.subject.primaryEmail
                  : null)
              }
              canManage={canManage}
              organizationId={organizationId}
              productId={productId}
            />
          ))}
        </div>
      ) : (
        <section className="dashboard-empty-card">
          <div>
            <h2>No access grants yet</h2>
            <p>
              {canManage
                ? "Add a grant when a member needs API actions."
                : "A product Owner or Admin can assign API actions to you."}
            </p>
          </div>
        </section>
      )}

      {canManage ? (
        <section className="dashboard-card access-create-card">
          <div className="dashboard-card-heading">
            <div>
              <h2>Grant access</h2>
              <p>
                Membership provides product collaboration; grants authorize specific API actions.
              </p>
            </div>
          </div>
          {eligibleMembers.length ? (
            <form action={createGrantAction} className="auth-form access-form">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="productId" value={productId} />
              <div className="form-grid">
                <label htmlFor="grant-subject">
                  Person
                  <CustomDropdown
                    aria-label="Person"
                    id="grant-subject"
                    name="subjectId"
                    required
                    defaultValue=""
                    placeholder="Select a product member"
                    options={eligibleMembers.map((member) => ({
                      value: member.membership.subjectId,
                      label: member.email ?? "Account unavailable",
                    }))}
                  />
                </label>
                <div className="form-field-with-tooltip">
                  <div className="form-label-row">
                    <label htmlFor="grant-scope">Scope</label>
                    <Tooltip content="A product grant covers all resources in this product. Project and workspace grants narrow access to one resource." />
                  </div>
                  <CustomDropdown
                    aria-label="Scope"
                    id="grant-scope"
                    name="scopeKind"
                    defaultValue="product"
                    options={[
                      { value: "product", label: "Entire product" },
                      { value: "project", label: "One project" },
                      { value: "workspace", label: "One workspace" },
                    ]}
                  />
                </div>
                <div className="form-field-with-tooltip">
                  <div className="form-label-row">
                    <label htmlFor="grant-resource-id">Project or workspace ID</label>
                    <Tooltip content="Enter the exact project or workspace ID. Leave blank for product-wide access." />
                  </div>
                  <input
                    id="grant-resource-id"
                    name="resourceId"
                    maxLength={128}
                    placeholder="Optional for product access"
                  />
                </div>
                <label htmlFor="grant-actions">
                  Actions
                  <input
                    id="grant-actions"
                    name="actions"
                    required
                    maxLength={2048}
                    placeholder="project.read, workspace.update"
                  />
                  <small>Comma-separated action names.</small>
                </label>
              </div>
              <button className="button button-primary" type="submit">
                Create access grant
              </button>
            </form>
          ) : (
            <p className="form-hint">
              Invite and verify a product member before assigning API actions.
            </p>
          )}
        </section>
      ) : null}
      <p className="role-help">
        A product role never grants API actions by itself. API keys are limited to the actions in
        active grants.
      </p>
    </>
  );
}
