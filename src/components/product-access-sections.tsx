import Image from "next/image";
import { AccessGrantActionsFields } from "@/components/access-grant-actions-fields";
import { AccessGrantScopeFields } from "@/components/access-grant-scope-fields";
import { CustomDropdown } from "@/components/custom-dropdown";
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
            {grant.accessRole?.name ?? "Custom permissions"} · {actions.length} app permission
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
    </article>
  );
}

export function AccessGrantExplainer() {
  return (
    <section className="dashboard-card access-explainer" aria-labelledby="access-explainer-title">
      <div className="access-visual-overview">
        <div className="dashboard-card-heading">
          <div>
            <h2 id="access-explainer-title">Choose where permissions apply</h2>
            <p>Choose whether app permissions apply to a whole product or one resource.</p>
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
    <section className="dashboard-card access-create-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Assign permissions</h2>
          <p>
            Choose a product member, where the permissions apply, and a permission set or custom
            actions.
          </p>
        </div>
      </div>
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
