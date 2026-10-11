"use client";

import { useActionState, useId } from "react";
import { createApiKeyAction, type CreateApiKeyState } from "@/app/actions";
import { ApiKeyFormFields, type ApiKeyFormDefaults } from "@/components/api-key-form-fields";
import type { ProductRecord } from "@/lib/auth/domain";

interface ApiKeyFormProps {
  rotateFromApiKeyId?: string;
  submitLabel?: string;
  organizationId: string;
  products: ProductRecord[];
  returnTo: string;
  defaults?: ApiKeyFormDefaults;
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
  const formId = useId();

  return (
    <form action={action} className="auth-form management-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {rotateFromApiKeyId ? (
        <input type="hidden" name="rotateFromApiKeyId" value={rotateFromApiKeyId} />
      ) : null}
      <ApiKeyFormFields defaults={defaults} formId={formId} products={products} />
      <p className="form-hint">
        Choose a product where your account already has the selected actions. Add a project or
        workspace ID when needed.
      </p>
      <button className="button button-primary form-submit" disabled={pending} type="submit">
        {pending ? "Saving…" : submitLabel}
      </button>
      {state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
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
