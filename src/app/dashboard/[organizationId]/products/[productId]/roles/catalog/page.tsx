import Link from "next/link";
import { ConfirmationActionControl } from "@/components/confirmation-action-control";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ProductPageNavigation } from "@/components/product-navigation";
import type { ProductAccessRole } from "@/lib/auth/access-roles";
import {
  getProductManagementPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";

function sameValues(left: readonly string[], right: readonly string[]) {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function matchesCatalogRole(current: ProductAccessRole, incoming: ProductAccessRole) {
  return (
    current.name === incoming.name &&
    current.description === incoming.description &&
    (current.role ?? "") === (incoming.role ?? "") &&
    sameValues(current.actions, incoming.actions) &&
    sameValues(current.scopeKinds ?? [], incoming.scopeKinds ?? [])
  );
}

export default async function ProductRoleCatalogPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ organizationId, productId, access }, query] = await Promise.all([
    getProductManagementPageContext(params),
    searchParams,
  ]);

  const rolesPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`;
  const staged = access.product.stagedAccessRoleCatalog;
  const currentCatalogRoles = (access.product.accessRoles ?? []).filter(
    (role) => !!role.catalogSource,
  );
  const currentBySourceId = new Map(
    currentCatalogRoles.map((role) => [role.catalogSource!.roleId, role]),
  );
  const incomingIds = new Set(staged?.catalog.roles.map((role) => role.id) ?? []);
  const changes = (staged?.catalog.roles ?? []).map((role) => {
    const current = currentBySourceId.get(role.id);
    const state = !current
      ? "New role"
      : matchesCatalogRole(current, role)
        ? "No permission changes"
        : "Role permissions changed";
    return {
      role,
      current,
      state,
      addedActions: role.actions.filter((action) => !current?.actions.includes(action)),
      removedActions: (current?.actions ?? []).filter((action) => !role.actions.includes(action)),
      addedScopes: role.scopeKinds.filter((scope) => !current?.scopeKinds?.includes(scope)),
      removedScopes: (current?.scopeKinds ?? []).filter((scope) => !role.scopeKinds.includes(scope)),
    };
  });
  const retired = currentCatalogRoles.filter(
    (role) => !incomingIds.has(role.catalogSource!.roleId) && !role.deprecated,
  );
  return (
    <>
      <DashboardHeading
        description="Fetch the roles published by this product, review the changes, then choose whether to apply them."
        action={
          <Link className="button button-secondary" href={rolesPath}>
            Back to permission sets
          </Link>
        }
      />
      <ProductPageNavigation
        access={access}
        organizationId={organizationId}
        productId={productId}
      />
      {query.notice === "role-catalog-staged" ? (
        <DashboardNotice message="Catalog fetched. Review the roles and changes below." kind="success" />
      ) : null}
      {query.notice === "role-catalog-applied" ? (
        <DashboardNotice message="Product roles updated. Existing grants were left unchanged." kind="success" />
      ) : null}
      {query.error === "role-catalog-fetch" ? (
        <DashboardNotice message="Could not fetch a valid role catalog from the registered product website." kind="error" />
      ) : null}
      {query.error === "role-catalog-apply" ? (
        <DashboardNotice message="Could not apply this catalog. Check for duplicate names or role limits, then fetch it again." kind="error" />
      ) : null}

      <section className="dashboard-card access-role-catalog-card">
        <div className="dashboard-card-heading">
          <div>
            <h2>Product-published roles</h2>
            <p>
              Perminister reads the fixed catalog endpoint from the registered website:
              <br />
              <code>{access.product.websiteUrl}/api/perminister/role-catalog</code>
            </p>
          </div>
        </div>
        <form action="/actions/fetchProductAccessRoleCatalogAction" method="post" className="auth-form">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="productId" value={productId} />
          <button className="button button-primary" type="submit">
            Fetch latest role catalog
          </button>
        </form>
        <p className="form-hint">
          Fetching only stages the catalog. Nothing changes until an administrator reviews and applies it.
        </p>
        {access.product.roleCatalogVersion ? (
          <p className="form-hint">
            Currently applied version: {access.product.roleCatalogVersion}
            {access.product.roleCatalogImportedAt
              ? ` · applied ${new Date(access.product.roleCatalogImportedAt).toLocaleString()}`
              : ""}
          </p>
        ) : null}
      </section>

      {staged ? (
        <section className="dashboard-card access-role-catalog-card">
          <div className="dashboard-card-heading">
            <div>
              <h2>Review version {staged.catalog.version}</h2>
              <p>
                Fetched {new Date(staged.fetchedAt).toLocaleString()}. {changes.filter((item) => item.state === "New role").length} new, {changes.filter((item) => item.state === "Role permissions changed").length} changed, {retired.length} retiring.
              </p>
            </div>
          </div>
          {changes.length ? (
            <div className="access-role-list">
              {changes.map(({ role, current, state, addedActions, removedActions, addedScopes, removedScopes }) => (
                <article className="access-role-item" key={role.id}>
                  <div className="access-role-item-details">
                    <strong>{role.name}</strong>
                    <span>{state} · applies to {role.scopeKinds.join(", ")}</span>
                    {current && current.name !== role.name ? (
                      <span>Name changed from {current.name}.</span>
                    ) : null}
                    {current && current.role !== role.role ? (
                      <span>Product role changed from {current.role ?? "none"} to {role.role ?? "none"}.</span>
                    ) : null}
                    {current && current.description !== role.description ? (
                      <span>Description changed.</span>
                    ) : null}
                    {addedScopes.length ? <span>New scopes: {addedScopes.join(", ")}</span> : null}
                    {removedScopes.length ? <span>Removed scopes: {removedScopes.join(", ")}</span> : null}
                    <span>{role.description || "No description"}</span>
                    {addedActions.length ? (
                      <span>Added actions: {addedActions.map((action) => <code key={action}>{action}</code>)}</span>
                    ) : null}
                    {removedActions.length ? (
                      <span>Removed actions: {removedActions.map((action) => <code key={action}>{action}</code>)}</span>
                    ) : null}
                    <div aria-label={`${role.name} permission actions`} className="access-role-actions" role="group">
                      {role.actions.map((action) => <code key={action}>{action}</code>)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {retired.length ? (
            <div className="form-hint">
              <strong>Roles to retire</strong>
              <ul>
                {retired.map((role) => <li key={role.id}>{role.name}</li>)}
              </ul>
              Retired roles will no longer be offered for new assignments. Existing grants keep their permissions.
            </div>
          ) : null}
          <ConfirmationActionControl
            action="/actions/applyProductAccessRoleCatalogAction"
            fields={[
              { name: "organizationId", value: organizationId },
              { name: "productId", value: productId },
            ]}
            triggerLabel="Apply reviewed roles"
            triggerAriaLabel="Apply the reviewed product role catalog"
            title={`Apply version ${staged.catalog.version}?`}
            description="This updates the permission sets available for future assignments. Retired roles cannot be assigned again. Existing grants keep their current permissions."
            confirmLabel="Apply product roles"
          />
          <p className="form-hint">
            If the product changes its catalog after this review, fetch it again before applying the newer version.
          </p>
        </section>
      ) : null}
    </>
  );
}
