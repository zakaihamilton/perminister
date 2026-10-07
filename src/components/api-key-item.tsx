import type { ReactNode } from "react";
import { revokeApiKeyAction } from "@/app/actions";
import { DashboardNotice } from "@/components/dashboard-shell";
import type { ApiKeyRecord } from "@/lib/auth/domain";

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
        <DashboardNotice message="API key revoked." kind="success" />
      ) : null}
      {error === "key-revoke-failed" ? (
        <DashboardNotice message="The API key could not be revoked." kind="error" />
      ) : null}
      {!isEmailVerified ? (
        <DashboardNotice message="Verify your email before creating API keys. Open Profile to request a verification link." />
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
  children,
}: {
  apiKey: ApiKeyRecord;
  scopeLabel: string;
  status: "active" | "revoked" | "expired";
  returnTo: string;
  extraActions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="record-item" key={apiKey.apiKeyId}>
      <div className="record-item-head">
        <div>
          <strong>Integration key</strong>
          <span className="record-meta">{scopeLabel}</span>
          <span className="record-meta">Actions: {apiKey.actions.join(", ")}</span>
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
          <form action={revokeApiKeyAction}>
            <input type="hidden" name="apiKeyId" value={apiKey.apiKeyId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="button button-secondary" type="submit">
              Revoke
            </button>
          </form>
        ) : null}
        {extraActions}
      </div>
      {children}
    </article>
  );
}
