import Image from "next/image";
import { AccessGrantActionsFields } from "@/components/access-grant-actions-fields";
import { AccessGrantScopeFields } from "@/components/access-grant-scope-fields";
import { CustomDropdown } from "@/components/custom-dropdown";
import { PermissionGrantDeleteControl } from "@/components/permission-grant-delete-control";
import type { ProductAccessRole } from "@/lib/auth/access-roles";
import type { MembershipRecord, ResourceScope } from "@/lib/auth/domain";
import type { ProductMemberView } from "@/lib/auth/service";

function scopeLabel(scope: ResourceScope): string {
  if (scope.kind === "product") return "Entire product";
  if (scope.kind === "project") return `Project ${scope.projectId}`;
  return `Workspace ${scope.workspaceId}`;
}

export function ProductAccessGrantCard({
  grant,
  email,
  productMember,
  canManage,
  organizationId,
  productId,
}: {
  grant: MembershipRecord;
  email: string | null;
  productMember?: ProductMemberView;
  canManage: boolean;
  organizationId: string;
  productId: string;
}) {
  const actions = grant.grants.flatMap((item) => item.actions);
  const memberLabel = email ?? `Product member · ${grant.subjectId.slice(0, 8)}`;
  const accessLabel = grant.accessRole?.name ?? "Custom permissions";
  const canChangeGrantStatus =
    grant.status === "active" || productMember?.membership.status === "active";
  return (
    <article className="access-grant-card">
      <div className="access-grant-member-heading">
        <strong>{memberLabel}</strong>
        <span className={`record-badge ${grant.status}`}>{grant.status}</span>
      </div>
      <div className="access-grant-main">
        <div>
          <span>{scopeLabel(grant.scope)}</span>
          {productMember ? (
            <small>
              Product role: {productMember.membership.role} · Product membership:{" "}
              {productMember.membership.status}
            </small>
          ) : null}
          <small>
            {accessLabel} · {actions.length} app permission
            {actions.length === 1 ? "" : "s"}
          </small>
        </div>
        <small className="access-role-action-names">Action names: {actions.join(", ")}</small>
      </div>
      {canManage ? (
        <div className="access-grant-actions">
          {canChangeGrantStatus ? (
            <form action="/actions/updateGrantStatusAction" method="post">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="membershipId" value={grant.membershipId} />
              <input
                type="hidden"
                name="status"
                value={grant.status === "active" ? "disabled" : "active"}
              />
              <button className="button button-secondary" type="submit">
                {grant.status === "active" ? "Remove permissions" : "Restore permissions"}
              </button>
            </form>
          ) : null}
          {grant.status === "disabled" ? (
            <PermissionGrantDeleteControl
              membershipId={grant.membershipId}
              organizationId={organizationId}
              productId={productId}
              memberLabel={memberLabel}
              scopeLabel={scopeLabel(grant.scope)}
              accessLabel={accessLabel}
              actionCount={actions.length}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function AccessGrantExplainer() {
  return (
    <section className="dashboard-card access-explainer" aria-labelledby="access-explainer-title">
      <div className="access-explainer-content">
        <div className="dashboard-card-heading">
          <div>
            <h2 id="access-explainer-title">Choose where permissions apply</h2>
            <p>Choose whether app permissions apply to a whole product or one resource.</p>
          </div>
        </div>
        <div className="access-scope-guide" role="group" aria-label="Where permissions apply">
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
      </div>
      <Image
        className="access-visual-illustration"
        src="/illustrations/access-grant-scope.png"
        alt=""
        width={1448}
        height={1086}
        sizes="(max-width: 980px) 70vw, 165px"
      />
      <p className="access-explainer-note">
        API keys can use only actions included in a member&apos;s active permissions.
      </p>
    </section>
  );
}

export function AccessGrantCreationSection({
  eligibleMembers,
  organizationId,
  productId,
  accessRoles,
}: {
  eligibleMembers: readonly ProductMemberView[];
  organizationId: string;
  productId: string;
  accessRoles: readonly ProductAccessRole[];
}) {
  return (
    <section aria-label="Permission assignment form" className="dashboard-card access-create-card">
      {eligibleMembers.length ? (
        <form action="/actions/createGrantAction" method="post" className="auth-form access-form">
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
            Assign permissions
          </button>
        </form>
      ) : (
        <p className="form-hint">
          Invite and verify a product member before assigning app permissions.
        </p>
      )}
    </section>
  );
}
