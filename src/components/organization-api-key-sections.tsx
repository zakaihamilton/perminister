import Link from "next/link";
import { ApiKeyItem } from "@/components/api-key-item";
import type { ApiKeyRecord, ProductRecord, ResourceScope } from "@/lib/auth/domain";

function scopeText(scope: ResourceScope, productNames: Map<string, string>): string {
  const product = productNames.get(scope.productId) ?? scope.productId;
  if (scope.kind === "product") return product;
  if (scope.kind === "project") return `${product} · Project ${scope.projectId}`;
  return `${product} · Workspace ${scope.workspaceId}`;
}

export function OrganizationApiKeyRecords({
  keys,
  now,
  organizationId,
  productNames,
  returnTo,
}: {
  keys: ApiKeyRecord[];
  now: number;
  organizationId: string;
  productNames: Map<string, string>;
  returnTo: string;
}) {
  if (!keys.length) {
    return (
      <section className="dashboard-empty-card api-key-empty-card">
        <div>
          <h2>No API keys yet</h2>
          <p>Choose a product below to view its keys or create one when access is granted.</p>
        </div>
      </section>
    );
  }

  return (
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
  );
}

export function OrganizationProductKeyLinks({
  organizationId,
  products,
}: {
  organizationId: string;
  products: ProductRecord[];
}) {
  if (!products.length) {
    return (
      <section className="dashboard-empty-card">
        <div>
          <h2>No products in this organization</h2>
          <p>An organization admin can add a product before API keys can be created.</p>
        </div>
      </section>
    );
  }

  return (
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
  );
}

export function ApiKeyAccessHint({
  canCreate,
  hasProducts,
  isEmailVerified,
}: {
  canCreate: boolean;
  hasProducts: boolean;
  isEmailVerified: boolean;
}) {
  if (canCreate || !isEmailVerified || !hasProducts) return null;
  return (
    <p className="form-hint api-key-empty-hint">
      An active access grant is required before you can create a key.
    </p>
  );
}
