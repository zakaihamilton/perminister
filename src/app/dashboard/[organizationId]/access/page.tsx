import { createGrantAction, updateGrantStatusAction } from "@/app/actions";
import { CustomDropdown } from "@/components/custom-dropdown";
import { Tooltip } from "@/components/tooltip";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listOrganizationMembers,
  listOrganizationPermissionGrants,
  listProductsForOrganization,
  type OrganizationMemberView,
} from "@/lib/auth/service";
import type { MembershipRecord, ResourceScope } from "@/lib/auth/domain";
import { redirect } from "next/navigation";

function scopeLabel(scope: ResourceScope, products: Map<string, string>): string {
  const product = products.get(scope.productId) ?? scope.productId;
  if (scope.kind === "product") return product;
  if (scope.kind === "project") return `${product} · Project ${scope.projectId}`;
  return `${product} · Workspace ${scope.workspaceId}`;
}

function GrantCard({
  grant,
  members,
  products,
  canManage,
  organizationId,
}: {
  grant: MembershipRecord;
  members: Map<string, OrganizationMemberView>;
  products: Map<string, string>;
  canManage: boolean;
  organizationId: string;
}) {
  const label =
    members.get(grant.subjectId)?.email ?? (canManage ? "Organization member" : "Your access");
  return (
    <article className="access-grant-card">
      <div className="access-grant-main">
        <div>
          <strong>{label}</strong>
          <span>{scopeLabel(grant.scope, products)}</span>
          <small>{grant.grants.flatMap((item) => item.actions).join(", ")}</small>
        </div>
        <span className={`record-badge ${grant.status}`}>{grant.status}</span>
      </div>
      {canManage ? (
        <form action={updateGrantStatusAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
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

export default async function AccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const [organization, products, grants] = await Promise.all([
    getOrganizationForSubject(current.subject.subjectId, organizationId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
    listOrganizationPermissionGrants(current.subject.subjectId, organizationId),
  ]);
  const canManage =
    organization.membership.role === "owner" || organization.membership.role === "admin";
  const members = canManage
    ? await listOrganizationMembers(current.subject.subjectId, organizationId)
    : [];
  const memberMap = new Map(members.map((member) => [member.membership.subjectId, member]));
  const productMap = new Map(products.map((product) => [product.productId, product.name]));
  const eligibleMembers = members.filter(
    (member) => member.emailVerified && member.membership.status === "active",
  );

  return (
    <>
      <DashboardHeading
        eyebrow="Workspace"
        title="Access"
        description={
          canManage
            ? "Grant product actions to people in your organization."
            : "Products and actions currently assigned to you."
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
          message="That access change could not be completed. Check the person, product, and organization role."
          kind="error"
        />
      ) : null}

      {canManage && !products.length ? (
        <section className="dashboard-empty-card">
          <div>
            <h2>Add a product first</h2>
            <p>Access grants need a product in this organization.</p>
          </div>
          <a className="button button-primary" href={`/dashboard/${organizationId}/products/new`}>
            Create product
          </a>
        </section>
      ) : null}
      {grants.length ? (
        <div className="access-grant-list">
          {grants.map((grant) => (
            <GrantCard
              key={grant.membershipId}
              grant={grant}
              members={memberMap}
              products={productMap}
              canManage={canManage}
              organizationId={organizationId}
            />
          ))}
        </div>
      ) : (
        <section className="dashboard-empty-card">
          <div>
            <h2>No access grants yet</h2>
            <p>
              {canManage
                ? "Grant a team member access to a product when you’re ready."
                : "An organization admin can assign product access to your account."}
            </p>
          </div>
        </section>
      )}

      {canManage && products.length ? (
        <section className="dashboard-card access-create-card">
          <div className="dashboard-card-heading">
            <div>
              <h2>Grant access</h2>
              <p>Choose a person, product scope, and the actions they can use.</p>
            </div>
          </div>
          {eligibleMembers.length ? (
            <form action={createGrantAction} className="auth-form access-form">
              <input type="hidden" name="organizationId" value={organizationId} />
              <div className="form-grid">
                <label htmlFor="grant-subject">
                  Person
                  <CustomDropdown
                    aria-label="Person"
                    id="grant-subject"
                    name="subjectId"
                    required
                    defaultValue=""
                    placeholder="Select a team member"
                    options={eligibleMembers.map((member) => ({
                      value: member.membership.subjectId,
                      label: member.email ?? "Account unavailable",
                    }))}
                  />
                </label>
                <label htmlFor="grant-product">
                  Product
                  <CustomDropdown
                    aria-label="Product"
                    id="grant-product"
                    name="productId"
                    required
                    defaultValue={products[0]?.productId ?? ""}
                    options={products.map((product) => ({
                      value: product.productId,
                      label: product.name,
                    }))}
                  />
                </label>
                <div className="form-field-with-tooltip">
                  <div className="form-label-row">
                    <label htmlFor="grant-scope">Scope</label>
                    <Tooltip content="A product grant covers all resources in that product. Project and workspace grants narrow access to one resource." />
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
                    <Tooltip content="Enter the exact project or workspace ID used by the product. Leave it blank for product-wide access." />
                  </div>
                  <input
                    id="grant-resource-id"
                    name="resourceId"
                    maxLength={128}
                    placeholder="Optional for product access"
                  />
                </div>
              </div>
              <label>
                Allowed actions
                <input
                  name="actions"
                  required
                  maxLength={2048}
                  placeholder="read:profile, write:profile"
                />
              </label>
              <p className="form-hint">
                Use action names from your product. Product grants include resources inside that
                product.
              </p>
              <button className="button button-primary" type="submit">
                Create access grant
              </button>
            </form>
          ) : (
            <p className="empty-list">
              Invite and verify a member before creating an access grant.
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
