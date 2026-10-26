import type { ReactNode } from "react";
import { DashboardNotice } from "@/components/dashboard-shell";
import { ConfirmationActionControl } from "@/components/confirmation-action-control";
import type { ApiKeyRecord } from "@/lib/auth/domain";
import { ProductPageNavigation } from "@/components/product-navigation";
import type { ProductAccessSummary } from "@/lib/auth/service";

export function ProductApiKeyPageNavigation({
  access,
  organizationId,
  productId,
  notice,
  error,
  isEmailVerified,
}: {
  access: Pick<ProductAccessSummary, "product" | "membership">;
  organizationId: string;
  productId: string;
  notice?: string;
  error?: string;
  isEmailVerified: boolean;
}) {
  return (
    <>
      <ProductPageNavigation
        access={access}
        organizationId={organizationId}
        productId={productId}
      />
      <ApiKeyNotices error={error} isEmailVerified={isEmailVerified} notice={notice} />
    </>
  );
}

export function ApiKeyNotices({
  notice,
  error,
  isEmailVerified,
}: {
  notice?: string;
  error?: string;
  isEmailVerified: boolean;
}) {
  return (
    <>
      {notice === "key-revoked" ? (
        <DashboardNotice message="API key revoked. It can no longer be used." kind="success" />
      ) : null}
      {error === "key-revoke-failed" ? (
        <DashboardNotice message="Could not revoke the API key. Try again." kind="error" />
      ) : null}
      {!isEmailVerified ? (
        <DashboardNotice message="Verify your email before creating API keys. Go to Account to request a verification link." />
      ) : null}
    </>
  );
}

export function ApiKeyItem({
  apiKey,
  scopeLabel,
  status,
  returnTo,
  extraActions,
}: {
  apiKey: ApiKeyRecord;
  scopeLabel: string;
  status: "active" | "revoked" | "expired";
  returnTo: string;
  extraActions?: ReactNode;
}) {
  return (
    <article className="record-item" key={apiKey.apiKeyId}>
      <div className="record-item-head">
        <div>
          <strong>API key</strong>
          <span className="record-meta">{scopeLabel}</span>
          <span className="record-meta">Can do: {apiKey.actions.join(", ")}</span>
          <span className="record-meta">
            Created {new Date(apiKey.createdAt).toLocaleString()} ·{" "}
            {apiKey.expiresAt
              ? `Expires ${new Date(apiKey.expiresAt).toLocaleString()}`
              : "No expiration"}
          </span>
        </div>
        <span className={`record-badge ${status}`}>{status}</span>
      </div>
      <div className="record-actions">
        {status === "active" ? (
          <ConfirmationActionControl
            action="/actions/revokeApiKeyAction"
            fields={[
              { name: "apiKeyId", value: apiKey.apiKeyId },
              { name: "returnTo", value: returnTo },
            ]}
            triggerLabel="Revoke API key"
            title="Revoke this API key?"
            description="This key will stop working immediately. Any app or script that uses it must be updated to use another key."
            confirmLabel="Revoke API key"
          />
        ) : null}
        {extraActions}
      </div>
    </article>
  );
}
