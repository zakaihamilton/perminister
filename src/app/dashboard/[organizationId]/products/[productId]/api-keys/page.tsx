import Link from "next/link";
import { ApiKeyForm } from "@/components/api-key-form";
import { ApiKeyItem, ApiKeyNotices } from "@/components/api-key-item";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getProductAccessForSubject,
  listApiKeysForSubject,
  listOrganizationPermissionGrants,
} from "@/lib/auth/service";
import type { ApiKeyRecord, ResourceScope } from "@/lib/auth/domain";
import { notFound, redirect } from "next/navigation";

function keyStatus(key: ApiKeyRecord): "active" | "revoked" | "expired" {
  if (key.status === "revoked") return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) return "expired";
  return "active";
}

function scopeText(scope: ResourceScope): string {
  if (scope.kind === "product") return "Entire product";
  if (scope.kind === "project") return `Project ${scope.projectId}`;
  return `Workspace ${scope.workspaceId}`;
}

export default async function ProductApiKeysPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; productId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId, productId }, query] = await Promise.all([params, searchParams]);
  const access = await getProductAccessForSubject(
    current.subject.subjectId,
    organizationId,
    productId,
  ).catch(() => null);
  if (!access) notFound();

  const [allKeys, grants] = await Promise.all([
    listApiKeysForSubject(current.subject.subjectId),
    listOrganizationPermissionGrants(current.subject.subjectId, organizationId),
  ]);
  const keys = allKeys.filter(
    (key) => key.scope.organizationId === organizationId && key.scope.productId === productId,
  );
  const ownActiveGrants = grants.filter(
    (grant) =>
      grant.subjectId === current.subject.subjectId &&
      grant.scope.productId === productId &&
      grant.status === "active",
  );
  const canCreate = !!current.subject.emailVerifiedAt && ownActiveGrants.length > 0;
  const returnTo = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/api-keys`;
  const canManageAccess =
    access.membership?.role === "owner" || access.membership?.role === "admin";

  return (
    <>
      <DashboardHeading
        eyebrow={access.product.name}
        title="API keys"
        description="Create and manage server credentials scoped to this product."
        action={
          <div className="product-detail-actions">
            {canCreate ? (
              <Link className="button button-primary" href="#create-api-key">
                Create API key
              </Link>
            ) : (
              <button className="button button-primary" disabled type="button">
                Create API key
              </button>
            )}
            {canManageAccess ? (
              <Link
                className="button button-secondary"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
              >
                Manage access
              </Link>
            ) : null}
          </div>
        }
      />
      <ApiKeyNotices
        notice={query.notice}
        error={query.error}
        isEmailVerified={!!current.subject.emailVerifiedAt}
      />

      {keys.length ? (
        <div className="record-list api-key-list">
          {keys.map((key) => {
            const status = keyStatus(key);
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
                      products={[access.product]}
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
      ) : (
        <section className="dashboard-empty-card api-key-empty-card">
          <div>
            <h2>No API keys for {access.product.name} yet</h2>
            <p>Keys created for this product will appear here.</p>
          </div>
        </section>
      )}

      {canCreate ? (
        <section
          className="dashboard-card create-api-key-card api-key-create-card"
          id="create-api-key"
        >
          <div className="dashboard-card-heading">
            <div>
              <h2>Create API key</h2>
              <p>Choose the product actions and scope this key should use.</p>
            </div>
          </div>
          <ApiKeyForm
            organizationId={organizationId}
            products={[access.product]}
            returnTo={returnTo}
          />
        </section>
      ) : (
        <section className="dashboard-empty-card api-key-gate-card">
          <div>
            <h2>Product access required</h2>
            <p>
              {current.subject.emailVerifiedAt
                ? "An active access grant for this product is required before you can create a key."
                : "Verify your email before creating an API key."}
            </p>
            {canManageAccess ? (
              <Link
                className="text-link api-key-access-link"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
              >
                Review product access
              </Link>
            ) : null}
          </div>
        </section>
      )}
      <p className="role-help">
        The full key appears once after creation. Copy it into your server’s secret store.
      </p>
    </>
  );
}
