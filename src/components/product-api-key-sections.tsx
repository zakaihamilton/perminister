import Link from "next/link";
import { ApiKeyRotationControl } from "@/components/api-key-rotation-control";
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
            extraActions={
              status === "active" && canCreate ? (
                <ApiKeyRotationControl
                  apiKey={key}
                  organizationId={organizationId}
                  product={product}
                  returnTo={returnTo}
                />
              ) : undefined
            }
            key={key.apiKeyId}
            returnTo={returnTo}
            scopeLabel={scopeText(key.scope)}
            status={status}
          />
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
        aria-label="API key details"
        className="dashboard-card create-api-key-card api-key-create-card"
        id="create-api-key"
      >
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
