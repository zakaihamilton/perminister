"use client";

import { useActionState } from "react";
import { createApiKeyAction, type CreateApiKeyState } from "@/app/actions";
import type { ProductRecord, ResourceScope } from "@/lib/auth/domain";

interface ApiKeyFormProps {
  rotateFromApiKeyId?: string;
  submitLabel?: string;
  organizationId: string;
  products: ProductRecord[];
  returnTo: string;
  defaults?: {
    scope: ResourceScope;
    actions: readonly string[];
    expiresInDays: string;
  };
}

export function ApiKeyForm({
  rotateFromApiKeyId,
  submitLabel = "Create API key",
  organizationId,
  products,
  returnTo,
  defaults,
}: ApiKeyFormProps) {
  const [state, action, pending] = useActionState<CreateApiKeyState, FormData>(
    createApiKeyAction,
    {},
  );
  const scopeKind = defaults?.scope.kind ?? "product";
  const resourceId = defaults?.scope.kind === "project"
    ? defaults.scope.projectId
    : defaults?.scope.kind === "workspace"
      ? defaults.scope.workspaceId
      : "";

  return (
    <form action={action} className="auth-form management-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {rotateFromApiKeyId ? (
        <input type="hidden" name="rotateFromApiKeyId" value={rotateFromApiKeyId} />
      ) : null}
      <div className="form-grid">
        <label>
          Scope type
          <select name="scopeKind" defaultValue={scopeKind}>
            <option value="product">Product</option>
            <option value="project">Project</option>
            <option value="workspace">Workspace</option>
          </select>
        </label>
        <label>
          Product
          <select name="productId" required defaultValue={defaults?.scope.productId ?? products[0]?.productId ?? ""}>
            <option value="" disabled>Select a product</option>
            {products.map((product) => <option key={product.productRecordId} value={product.productId}>{product.name}</option>)}
          </select>
        </label>
        <label>
          Project or workspace ID
          <input name="resourceId" maxLength={128} defaultValue={resourceId} />
        </label>
        <label>
          Allowed actions
          <input name="actions" required maxLength={2048} defaultValue={defaults?.actions.join(", ") ?? ""} placeholder="read:profile, write:profile" />
        </label>
        <label>
          Expiration
          <select name="expiresInDays" defaultValue={defaults?.expiresInDays ?? "30"}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="never">No expiration</option>
          </select>
        </label>
      </div>
      <p className="form-hint">Choose a product where your account already has the selected actions. Add a project or workspace ID when needed.</p>
      <button className="button button-primary form-submit" disabled={pending} type="submit">
        {pending ? "Saving…" : submitLabel}
      </button>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.token ? (
        <section className="one-time-secret" aria-live="polite">
          <strong>Copy this key now. It will not be shown again.</strong>
          <code>{state.token}</code>
          {state.warning ? <p className="form-error">{state.warning}</p> : null}
        </section>
      ) : null}
    </form>
  );
}
