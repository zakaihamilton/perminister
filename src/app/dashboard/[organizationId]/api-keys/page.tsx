import { revokeApiKeyAction } from "@/app/actions";
import { ApiKeyForm } from "@/components/api-key-form";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listApiKeysForSubject,
  listOrganizationPermissionGrants,
  listProductsForOrganization,
} from "@/lib/auth/service";
import type { ApiKeyRecord, ResourceScope } from "@/lib/auth/domain";
import { redirect } from "next/navigation";

function keyStatus(key: ApiKeyRecord): "active" | "revoked" | "expired" {
  if (key.status === "revoked") return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) return "expired";
  return "active";
}

function scopeText(scope: ResourceScope, productNames: Map<string, string>): string {
  const product = productNames.get(scope.productId) ?? scope.productId;
  if (scope.kind === "product") return product;
  if (scope.kind === "project") return `${product} · Project ${scope.projectId}`;
  return `${product} · Workspace ${scope.workspaceId}`;
}

export default async function ApiKeysPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  await getOrganizationForSubject(current.subject.subjectId, organizationId);
  const [allKeys, products, grants] = await Promise.all([
    listApiKeysForSubject(current.subject.subjectId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
    listOrganizationPermissionGrants(current.subject.subjectId, organizationId),
  ]);
  const keys = allKeys.filter((key) => key.scope.organizationId === organizationId);
  const productNames = new Map(products.map((product) => [product.productId, product.name]));
  const ownActiveGrants = grants.filter(
    (grant) => grant.subjectId === current.subject.subjectId && grant.status === "active",
  );
  const allowedProductIds = new Set(ownActiveGrants.map((grant) => grant.scope.productId));
  const allowedProducts = products.filter((product) => allowedProductIds.has(product.productId));
  const canCreate = !!current.subject.emailVerifiedAt && allowedProducts.length > 0;
  const returnTo = `/dashboard/${organizationId}/api-keys`;

  return (
    <>
      <DashboardHeading
        eyebrow="Workspace"
        title="API keys"
        description="Create and manage server credentials for products you can access."
      />
      {query.notice === "key-revoked" ? (
        <DashboardNotice message="API key revoked." kind="success" />
      ) : null}
      {query.error === "key-revoke-failed" ? (
        <DashboardNotice message="The API key could not be revoked." kind="error" />
      ) : null}
      {!current.subject.emailVerifiedAt ? (
        <DashboardNotice message="Verify your email before creating API keys. Open Profile to request a verification link." />
      ) : null}
      {!products.length ? (
        <section className="dashboard-empty-card">
          <div>
            <h2>No products in this organization</h2>
            <p>An organization admin can add a product before you create a key.</p>
          </div>
        </section>
      ) : null}
      {keys.length ? (
        <div className="record-list api-key-list">
          {keys.map((key) => {
            const status = keyStatus(key);
            return (
              <article className="record-item" key={key.apiKeyId}>
                <div className="record-item-head">
                  <div>
                    <strong>Integration key</strong>
                    <span className="record-meta">{scopeText(key.scope, productNames)}</span>
                    <span className="record-meta">Actions: {key.actions.join(", ")}</span>
                    <span className="record-meta">
                      Created {new Date(key.createdAt).toLocaleString()} ·{" "}
                      {key.expiresAt
                        ? `Expires ${new Date(key.expiresAt).toLocaleString()}`
                        : "No expiration"}
                    </span>
                  </div>
                  <span className={`record-badge ${status}`}>{status}</span>
                </div>
                {status === "active" ? (
                  <div className="record-actions">
                    <form action={revokeApiKeyAction}>
                      <input type="hidden" name="apiKeyId" value={key.apiKeyId} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="button button-secondary" type="submit">
                        Revoke
                      </button>
                    </form>
                  </div>
                ) : null}
                {status === "active" &&
                allowedProducts.some((product) => product.productId === key.scope.productId) ? (
                  <details className="rotate-details">
                    <summary>Rotate this key</summary>
                    <ApiKeyForm
                      organizationId={organizationId}
                      products={allowedProducts}
                      returnTo={returnTo}
                      rotateFromApiKeyId={key.apiKeyId}
                      submitLabel="Create replacement key"
                      defaults={{
                        scope: key.scope,
                        actions: key.actions,
                        expiresInDays: key.expiresAt ? "30" : "never",
                      }}
                    />
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <section className="dashboard-empty-card">
          <div>
            <h2>No API keys yet</h2>
            <p>Create a key after an admin grants you product actions.</p>
          </div>
        </section>
      )}
      {canCreate ? (
        <section className="dashboard-card create-api-key-card">
          <div className="dashboard-card-heading">
            <div>
              <h2>Create API key</h2>
              <p>Pick a product, allowed actions, and an expiration.</p>
            </div>
          </div>
          <ApiKeyForm
            organizationId={organizationId}
            products={allowedProducts}
            returnTo={returnTo}
          />{" "}
        </section>
      ) : null}
      {!canCreate && current.subject.emailVerifiedAt && products.length ? (
        <p className="form-hint api-key-empty-hint">
          An active access grant is required before you can create a key.
        </p>
      ) : null}
      <p className="role-help">
        The full key appears once after creation. Copy it into your server’s secret store.
      </p>
    </>
  );
}
