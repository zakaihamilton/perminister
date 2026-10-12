import type { ReactNode } from "react";
import Image from "next/image";
import { createProductAccessRoleAction, removeProductAccessRoleAction } from "@/app/actions";
import type { ProductAccessRole } from "@/lib/auth/access-roles";

export function ProductAccessRoleCatalog({
  accessRoles,
  children,
  organizationId,
  productId,
}: {
  accessRoles: readonly ProductAccessRole[];
  children: ReactNode;
  organizationId: string;
  productId: string;
}) {
  return (
    <section className="dashboard-card access-role-catalog-card">
      <div className="access-visual-overview">
        <div className="dashboard-card-heading">
          <div>
            <h2>Reusable permission sets</h2>
            <p>Save a set of app permissions, then assign it to the people who need them.</p>
          </div>
        </div>
        <Image
          className="access-visual-illustration"
          src="/illustrations/product-access-roles.png"
          alt=""
          width={1448}
          height={1086}
          sizes="(max-width: 700px) 70vw, 280px"
        />
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
                  Remove permission set
                </button>
              </form>
            </article>
          ))}
        </div>
      ) : (
        <p className="form-hint">No permission sets yet. Add one below to reuse app permissions.</p>
      )}
      <p className="access-role-catalog-note">
        Use the exact action names your app checks. Removing a permission set stops new assignments;
        existing permissions stay in place.
      </p>
      {children}
    </section>
  );
}

export function CreateProductAccessRoleForm({
  accessRoleCount,
  organizationId,
  productId,
}: {
  accessRoleCount: number;
  organizationId: string;
  productId: string;
}) {
  return (
    <form action={createProductAccessRoleAction} className="auth-form access-role-create-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="productId" value={productId} />
      <label>
        Permission set name
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
          Ask the app developer if you do not know the exact action names. You only need to define
          this set once for this organization&apos;s product.
        </small>
      </label>
      <button className="button button-primary" type="submit" disabled={accessRoleCount >= 32}>
        Add permission set
      </button>
    </form>
  );
}
