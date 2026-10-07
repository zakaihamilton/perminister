import { createProductAccessRoleAction, removeProductAccessRoleAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import Image from "next/image";
import Link from "next/link";

export default async function ProductAccessRolesPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ organizationId, productId, access }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  requireProductManagerRole(access.membership?.role, organizationId, productId);

  const accessRoles = access.product.accessRoles ?? [];
  const accessPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`;

  return (
    <>
      <DashboardHeading
        description="Create reusable permission sets for this organization’s product."
        action={
          <Link className="button button-secondary" href={accessPath}>
            Grant access
          </Link>
        }
      />
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

      <section className="dashboard-card access-role-catalog-card">
        <div className="access-visual-overview">
          <div className="dashboard-card-heading">
            <div>
              <h2>Reusable permission sets</h2>
              <p>Bundle app actions once, then assign the role to people who need them.</p>
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
                    Remove role
                  </button>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <p className="form-hint">No roles yet. Add one below to reuse its app permissions.</p>
        )}
        <p className="access-role-catalog-note">
          Use the exact action names your app checks. Removing a role only removes it from future
          grants; existing grants keep their current permissions.
        </p>
        <form action={createProductAccessRoleAction} className="auth-form access-role-create-form">
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
    </>
  );
}
