"use client";

import { useId, useState, type FormEvent } from "react";
import type { CreateApiKeyState } from "@/app/actions";
import { submitStableAction } from "@/lib/action-client";
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
  const [state, setState] = useState<CreateApiKeyState>({});
  const [pending, setPending] = useState(false);
  const formId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      setState(
        await submitStableAction<CreateApiKeyState>(
          "createApiKeyAction",
          new FormData(event.currentTarget),
        ),
      );
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action="/actions/createApiKeyAction"
      method="post"
      onSubmit={handleSubmit}
      className="auth-form management-form"
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {rotateFromApiKeyId ? (
        <input type="hidden" name="rotateFromApiKeyId" value={rotateFromApiKeyId} />
      ) : null}
      <ApiKeyFormFields defaults={defaults} formId={formId} products={products} />
      <p className="form-hint">
        Choose a product where your account already has these permissions. Choose a project or
        workspace scope to limit where the key can be used.
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
