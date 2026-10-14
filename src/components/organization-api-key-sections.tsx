import Link from "next/link";
import { ApiKeyForm } from "@/components/api-key-form";
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
          <p>
            API keys you create for this organization will appear here. Create a key for a product
            where your account has active access.
          </p>
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
                View product API keys
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

export function OrganizationApiKeyCreationSection({
  canCreate,
  organizationId,
  products,
  returnTo,
}: {
  canCreate: boolean;
  organizationId: string;
  products: ProductRecord[];
  returnTo: string;
}) {
  if (!canCreate) return null;

  return (
    <section
      aria-label="API key details"
      className="dashboard-card create-api-key-card api-key-create-card"
      id="create-api-key"
    >
      <ApiKeyForm organizationId={organizationId} products={products} returnTo={returnTo} />
    </section>
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
          <p>An organization owner or admin can add a product before API keys can be created.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-card api-key-products-card" id="api-key-products">
      <div className="dashboard-card-heading">
        <div>
          <h2>API keys by product</h2>
          <p>Each product has its own API keys and settings.</p>
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
              View API keys
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
      You need active permission for a product before you can create a key.
    </p>
  );
}
