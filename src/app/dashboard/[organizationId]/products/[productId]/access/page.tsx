import {
  createGrantAction,
  createProductAccessRoleAction,
  removeProductAccessRoleAction,
  updateGrantStatusAction,
} from "@/app/actions";
import { AccessGrantActionsFields } from "@/components/access-grant-actions-fields";
import { AccessGrantScopeFields } from "@/components/access-grant-scope-fields";
import { CustomDropdown } from "@/components/custom-dropdown";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getProductAccessForSubject,
  listProductMembers,
  listProductPermissionGrants,
} from "@/lib/auth/service";
import type { MembershipRecord, ResourceScope } from "@/lib/auth/domain";
import { getConsumerClientsForProduct } from "@/lib/auth/consumer-clients";
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
  const actions = grant.grants.flatMap((item) => item.actions);
  return (
    <article className="access-grant-card">
      <div className="access-grant-main">
        <div>
          <strong>{email ?? "Product member"}</strong>
          <span>{scopeLabel(grant.scope)}</span>
          <small>
            {grant.accessRole?.name ?? "Custom actions"} · {actions.length} app permission
            {actions.length === 1 ? "" : "s"}
          </small>
          <details className="access-role-details">
            <summary>View action names</summary>
            <small>{actions.join(", ")}</small>
          </details>
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
  const connectedClients = getConsumerClientsForProduct(productId);
  const roleClient = connectedClients.length === 1 ? connectedClients[0] : null;
  const accessRoles = access.product.accessRoles ?? [];

  return (
    <>
      <DashboardHeading
        eyebrow={access.product.name}
        title="Access"
        description={
          canManage
            ? "Choose what product members can do and which resources it applies to."
            : "Review the app permissions assigned to you and where they apply."
        }
      />
      {query.notice === "grant-created" ? (
        <DashboardNotice message="Access grant created." kind="success" />
      ) : null}
      {query.notice === "grant-updated" ? (
        <DashboardNotice message="Access grant updated." kind="success" />
      ) : null}
      {query.notice === "access-role-created" ? (
        <DashboardNotice message="Access role added." kind="success" />
      ) : null}
      {query.notice === "access-role-removed" ? (
        <DashboardNotice message="Access role removed." kind="success" />
      ) : null}
      {query.error === "access-role" ? (
        <DashboardNotice
          message="The access role could not be saved. Use a unique role name and 1–32 valid action names."
          kind="error"
        />
      ) : null}
      {query.error === "grant-failed" ? (
        <DashboardNotice
          message="That access grant could not be created. Check the member and resource ID, or confirm the selected role is still configured."
          kind="error"
        />
      ) : null}

      <section className="dashboard-card access-explainer" aria-labelledby="access-explainer-title">
        <div className="dashboard-card-heading">
          <div>
            <h2 id="access-explainer-title">What is an access grant?</h2>
            <p>
              A grant lets a product member use app permissions within a chosen part of the product.
              Membership lets someone collaborate; an access grant controls what their account can
              do in the app.
            </p>
          </div>
        </div>
        <div className="access-scope-guide" role="group" aria-label="Grant scopes">
          <article>
            <h3>Entire product</h3>
            <p>The selected permissions apply across all resources in this product.</p>
          </article>
          <article>
            <h3>One project</h3>
            <p>
              The selected permissions apply to one project. Enter that project&apos;s exact ID.
            </p>
          </article>
          <article>
            <h3>One workspace</h3>
            <p>
              The selected permissions apply to one workspace. Enter that workspace&apos;s exact ID.
            </p>
          </article>
        </div>
        <div className="access-action-help">
          <h3>Choose what this person can do</h3>
          <p>
            {accessRoles.length
              ? "Choose a role your organization has set up for this product, then choose where it applies."
              : connectedClients.length > 1
                ? `Multiple application clients have credentials configured. This does not verify the app backend. ${canManage ? "You can define roles below." : "Ask a product Owner or Admin to define roles."}`
                : roleClient
                  ? `${roleClient.appName} has client credentials configured. This does not verify the app backend. ${canManage ? "Define reusable roles below." : "Ask a product Owner or Admin to define roles."}`
                  : `No application client credentials are configured yet. ${canManage ? "You can define roles, then connect and test the app separately." : "Ask a product Owner or Admin to set up access roles."}`}
          </p>
        </div>
        <p className="access-explainer-guidance">
          {canManage
            ? "To grant access, choose an active product member, pick a saved role or enter exact app action names, then choose which resources it covers."
            : "A product Owner or Admin manages grants. Contact one if you need different API actions or scope."}
        </p>
        <p className="access-explainer-note">
          API keys can use only actions included in a member&apos;s active grants.
        </p>
      </section>

      {canManage ? (
        <section className="dashboard-card access-role-catalog-card">
          <div className="dashboard-card-heading">
            <div>
              <h2>Access roles</h2>
              <p>
                Save common permission sets once for this organization&apos;s product, then reuse
                them when granting people access.
              </p>
            </div>
          </div>
          {accessRoles.length ? (
            <div className="access-role-list">
              {accessRoles.map((accessRole) => (
                <article className="access-role-item" key={accessRole.id}>
                  <div>
                    <strong>{accessRole.name}</strong>
                    <span>
                      {accessRole.description || "No description"} · {accessRole.actions.length}{" "}
                      permission{accessRole.actions.length === 1 ? "" : "s"}
                    </span>
                    <details className="access-role-details">
                      <summary>View action names</summary>
                      <small>{accessRole.actions.join(", ")}</small>
                    </details>
                  </div>
                  <form action={removeProductAccessRoleAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="productId" value={productId} />
                    <input type="hidden" name="accessRoleId" value={accessRole.id} />
                    <button className="button button-secondary" type="submit">
                      Remove role
                    </button>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <p className="form-hint">No roles yet. Create a role below to reuse its permissions.</p>
          )}
          <p className="access-role-catalog-note">
            Use the exact action names your app checks. Removing a role only removes it from future
            grants; existing grants keep their current permissions.
          </p>
          <form
            action={createProductAccessRoleAction}
            className="auth-form access-role-create-form"
          >
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="productId" value={productId} />
            <label>
              Role name
              <input
                name="roleName"
                required
                maxLength={80}
                placeholder="For example, Telemetry viewer"
              />
            </label>
            <label>
              Description <span className="form-hint">Optional</span>
              <input
                name="roleDescription"
                maxLength={240}
                placeholder="What a person with this role can do"
              />
            </label>
            <label>
              App permissions
              <textarea
                name="actions"
                required
                maxLength={2048}
                rows={2}
                placeholder="Enter exact action names, separated by commas"
                aria-describedby="access-role-actions-help"
              />
              <small className="access-form-field-help" id="access-role-actions-help">
                Ask the app developer if you do not know the exact action names. You only need to
                define this set once for this organization&apos;s product.
              </small>
            </label>
            <button
              className="button button-primary"
              type="submit"
              disabled={accessRoles.length >= 32}
            >
              Add access role
            </button>
          </form>
        </section>
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
                ? "Add access when a member needs to use app features."
                : "A product Owner or Admin can assign app permissions to you."}
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
                Choose a person, set where access applies, then pick a named role or enter custom
                actions.
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
                <AccessGrantScopeFields />
                <AccessGrantActionsFields roles={accessRoles} />
              </div>
              <button className="button button-primary" type="submit">
                Create access grant
              </button>
            </form>
          ) : (
            <p className="form-hint">
              Invite and verify a product member before assigning app permissions.
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
