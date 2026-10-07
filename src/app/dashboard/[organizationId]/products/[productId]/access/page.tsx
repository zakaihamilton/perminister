import { createGrantAction, updateGrantStatusAction } from "@/app/actions";
import { AccessGrantActionsFields } from "@/components/access-grant-actions-fields";
import { AccessGrantScopeFields } from "@/components/access-grant-scope-fields";
import { CustomDropdown } from "@/components/custom-dropdown";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import Image from "next/image";
import Link from "next/link";
import { listProductMembers, listProductPermissionGrants } from "@/lib/auth/service";
import {
  getProductPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import type { MembershipRecord, ResourceScope } from "@/lib/auth/domain";
import { redirect } from "next/navigation";

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
}: ProductPageWithSearchParams) {
  const [context, query] = await Promise.all([getProductPageContext(params), searchParams]);
  const { current, organizationId, productId, access } = context;
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
  const accessRoles = access.product.accessRoles ?? [];

  return (
    <>
      <DashboardHeading
        description={
          canManage
            ? "Choose what product members can do and which resources it applies to."
            : "Review the app permissions assigned to you and where they apply."
        }
        action={
          canManage ? (
            <Link
              className="button button-secondary"
              href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`}
            >
              Access roles
            </Link>
          ) : null
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
          message="That access grant could not be created. Check the member and resource ID, or confirm the selected role is still configured."
          kind="error"
        />
      ) : null}

      <section className="dashboard-card access-explainer" aria-labelledby="access-explainer-title">
        <div className="access-visual-overview">
          <div className="dashboard-card-heading">
            <div>
              <h2 id="access-explainer-title">Choose where access applies</h2>
              <p>A grant pairs app actions with a product, project, or workspace.</p>
            </div>
          </div>
          <Image
            className="access-visual-illustration"
            src="/illustrations/access-grant-scope.png"
            alt=""
            width={1448}
            height={1086}
            sizes="(max-width: 700px) 70vw, 280px"
          />
        </div>
        <div className="access-scope-guide" role="group" aria-label="Grant scopes">
          <article>
            <h3>Entire product</h3>
            <p>All resources in this product.</p>
          </article>
          <article>
            <h3>One project</h3>
            <p>Only the project ID you enter.</p>
          </article>
          <article>
            <h3>One workspace</h3>
            <p>Only the workspace ID you enter.</p>
          </article>
        </div>
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
