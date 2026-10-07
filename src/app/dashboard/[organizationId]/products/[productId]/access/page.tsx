import { createGrantAction, updateGrantStatusAction } from "@/app/actions";
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
            ? "Give product members the API actions they need, at the right scope."
            : "Review the API actions assigned to you and where they apply."
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
          message="That access grant could not be created. Check the selected member, required resource ID, and 1–32 exact action names."
          kind="error"
        />
      ) : null}

      <section className="dashboard-card access-explainer" aria-labelledby="access-explainer-title">
        <div className="dashboard-card-heading">
          <div>
            <h2 id="access-explainer-title">What is an access grant?</h2>
            <p>
              A grant lets a product member use specific API actions within a chosen part of the
              product. Membership lets someone collaborate in the product; it does not give them API
              permissions by itself.
            </p>
          </div>
        </div>
        <div className="access-scope-guide" role="group" aria-label="Grant scopes">
          <article>
            <h3>Entire product</h3>
            <p>The selected actions can be used across all resources in this product.</p>
          </article>
          <article>
            <h3>One project</h3>
            <p>The selected actions apply to one project. Enter that project&apos;s exact ID.</p>
          </article>
          <article>
            <h3>One workspace</h3>
            <p>
              The selected actions apply to one workspace. Enter that workspace&apos;s exact ID.
            </p>
          </article>
        </div>
        <div className="access-action-help">
          <h3>Actions are product-specific</h3>
          <p>
            Enter the exact action names the connected product checks during authorization. Separate
            multiple names with commas. For example, <code>project.read</code> or{" "}
            <code>workspace.update</code>; these are examples only, not a built-in list. Ask the
            product developer for the names to use.
          </p>
        </div>
        <p className="access-explainer-guidance">
          {canManage
            ? "To grant access, choose an active product member, decide which resources the grant covers, then list the API actions they need."
            : "A product Owner or Admin manages grants. Contact one if you need different API actions or scope."}
        </p>
        <p className="access-explainer-note">
          API keys can use only actions included in a member&apos;s active grants.
        </p>
      </section>

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
              <p>Choose who gets access, where it applies, and which actions they can use.</p>
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
                <label htmlFor="grant-actions">
                  API actions
                  <input
                    id="grant-actions"
                    name="actions"
                    required
                    maxLength={2048}
                    placeholder="Enter product-defined action names"
                    aria-describedby="grant-actions-help"
                  />
                  <small className="access-form-field-help" id="grant-actions-help">
                    Enter 1–32 comma-separated names that match the connected product&apos;s
                    actions.
                  </small>
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
    </>
  );
}
