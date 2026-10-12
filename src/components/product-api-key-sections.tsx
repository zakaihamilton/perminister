import Link from "next/link";
import { ApiKeyForm } from "@/components/api-key-form";
import { ApiKeyItem } from "@/components/api-key-item";
import type { ApiKeyRecord, ProductRecord, ResourceScope } from "@/lib/auth/domain";

function keyStatus(key: ApiKeyRecord, now: number): "active" | "revoked" | "expired" {
  if (key.status === "revoked") return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return "expired";
  return "active";
}

function scopeText(scope: ResourceScope): string {
  if (scope.kind === "product") return "Entire product";
  if (scope.kind === "project") return `Project ${scope.projectId}`;
  return `Workspace ${scope.workspaceId}`;
}

export function ProductApiKeyRecords({
  canCreate,
  keys,
  now,
  organizationId,
  product,
  returnTo,
}: {
  canCreate: boolean;
  keys: ApiKeyRecord[];
  now: number;
  organizationId: string;
  product: ProductRecord;
  returnTo: string;
}) {
  if (!keys.length) {
    return (
      <section className="dashboard-empty-card api-key-empty-card">
        <div>
          <h2>No API keys for {product.name} yet</h2>
          <p>Keys created for this product will appear here.</p>
        </div>
      </section>
    );
  }

  return (
    <div className="record-list api-key-list">
      {keys.map((key) => {
        const status = keyStatus(key, now);
        return (
          <ApiKeyItem
            apiKey={key}
            key={key.apiKeyId}
            returnTo={returnTo}
            scopeLabel={scopeText(key.scope)}
            status={status}
          >
            {status === "active" && canCreate ? (
              <details className="rotate-details">
                <summary>Rotate this key</summary>
                <ApiKeyForm
                  defaults={{
                    scope: key.scope,
                    actions: key.actions,
                    expiresInDays: key.expiresAt ? "30" : "never",
                  }}
                  organizationId={organizationId}
                  products={[product]}
                  returnTo={returnTo}
                  rotateFromApiKeyId={key.apiKeyId}
                  submitLabel="Create replacement key"
                />
              </details>
            ) : null}
          </ApiKeyItem>
        );
      })}
    </div>
  );
}

export function ProductApiKeyCreationSection({
  canCreate,
  canManageAccess,
  isEmailVerified,
  organizationId,
  product,
  productId,
  returnTo,
}: {
  canCreate: boolean;
  canManageAccess: boolean;
  isEmailVerified: boolean;
  organizationId: string;
  product: ProductRecord;
  productId: string;
  returnTo: string;
}) {
  if (canCreate) {
    return (
      <section
        className="dashboard-card create-api-key-card api-key-create-card"
        id="create-api-key"
      >
        <div className="dashboard-card-heading">
          <div>
            <h2>Create API key</h2>
            <p>Choose what this key can do and where it can be used.</p>
          </div>
        </div>
        <ApiKeyForm organizationId={organizationId} products={[product]} returnTo={returnTo} />
      </section>
    );
  }

  return (
    <section className="dashboard-empty-card api-key-gate-card">
      <div>
        <h2>Product permissions required</h2>
        <p>
          {isEmailVerified
            ? "You need active permission for this product before you can create a key."
            : "Verify your email before creating an API key."}
        </p>
        {canManageAccess ? (
          <Link
            className="text-link api-key-access-link"
            href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
          >
            Review permissions
          </Link>
        ) : null}
      </div>
    </section>
  );
}
