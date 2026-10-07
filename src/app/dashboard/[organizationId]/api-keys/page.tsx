import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ApiKeyItem, ApiKeyNotices } from "@/components/api-key-item";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listApiKeysForSubject,
  listOrganizationPermissionGrants,
  listProductsForOrganization,
} from "@/lib/auth/service";
import type { ResourceScope } from "@/lib/auth/domain";
import { redirect } from "next/navigation";

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
  const createHref =
    allowedProducts.length === 1
      ? `/dashboard/${organizationId}/products/${encodeURIComponent(allowedProducts[0].productId)}/api-keys`
      : "#api-key-products";

  // This request-rendered page must compare key expiry against the current time.
  const now =
    // eslint-disable-next-line react-hooks/purity
    Date.now();

  return (
    <>
      <DashboardHeading
        description="Review your keys here. Create and manage them from the product they belong to."
        action={
          canCreate ? (
            <Link className="button button-primary" href={createHref}>
              Create API key
            </Link>
          ) : (
            <button className="button button-primary" disabled type="button">
              Create API key
            </button>
          )
        }
      />
      <ApiKeyNotices
        error={query.error}
        isEmailVerified={!!current.subject.emailVerifiedAt}
        notice={query.notice}
      />

      {keys.length === 0 ? (
        <section className="dashboard-empty-card api-key-empty-card">
          <div>
            <h2>No API keys yet</h2>
            <p>Choose a product below to view its keys or create one when access is granted.</p>
          </div>
        </section>
      ) : (
        <div className="record-list api-key-list">
          {keys.map((key) => {
            const expired = !!key.expiresAt && Date.parse(key.expiresAt) <= now;
            const status = key.status === "revoked" ? "revoked" : expired ? "expired" : "active";
            const productHref = `/dashboard/${organizationId}/products/${encodeURIComponent(key.scope.productId)}/api-keys`;
            return (
              <ApiKeyItem
                apiKey={key}
                extraActions={
                  <Link className="button button-secondary" href={productHref}>
                    Manage product keys
                  </Link>
                }
                key={key.apiKeyId}
                returnTo={returnTo}
                scopeLabel={scopeText(key.scope, productNames)}
                status={status}
              />
            );
          })}
        </div>
      )}

      {products.length ? (
        <section className="dashboard-card api-key-products-card" id="api-key-products">
          <div className="dashboard-card-heading">
            <div>
              <h2>Product keys</h2>
              <p>Each product has its own key list and creation settings.</p>
            </div>
          </div>
          <div className="api-key-product-list">
            {products.map((product) => (
              <article className="api-key-product-row" key={product.productId}>
                <div>
                  <strong>{product.name}</strong>
                  <span>{product.description || product.websiteUrl}</span>
                </div>
                <Link
                  className="button button-secondary"
                  href={`/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}/api-keys`}
                >
                  Manage keys
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="dashboard-empty-card">
          <div>
            <h2>No products in this organization</h2>
            <p>An organization admin can add a product before API keys can be created.</p>
          </div>
        </section>
      )}

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
