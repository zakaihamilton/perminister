"use client";

import { useState, type FormEvent } from "react";
import type { ConsumerClientActionState } from "@/app/actions";
import { submitStableAction } from "@/lib/action-client";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import { ConsumerClientCreateForm } from "@/components/consumer-client-create-form";
import { ConsumerClientList } from "@/components/consumer-client-list";

interface ConsumerClientManagerProps {
  organizationId: string;
  productId: string;
  productName: string;
  returnTo: string;
  clients: ConsumerClientSummary[];
  readOnly?: boolean;
}

export function ConsumerClientManager({
  organizationId,
  productId,
  productName,
  returnTo,
  clients,
  readOnly = false,
}: ConsumerClientManagerProps) {
  const [state, setState] = useState<ConsumerClientActionState>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      setState(
        await submitStableAction<ConsumerClientActionState>(
          "createOrRotateConsumerClientAction",
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
    <>
      {!readOnly && state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {!readOnly && state.clientId && state.secret ? (
        <section className="one-time-secret" aria-live="polite">
          <strong>Copy these app client details now. The secret will not be shown again.</strong>
          <span>Client ID</span>
          <code>{state.clientId}</code>
          <span>Client secret</span>
          <code>{state.secret}</code>
          <p>Store both values in the application backend&apos;s environment.</p>
        </section>
      ) : null}
      {!readOnly ? (
        <ConsumerClientCreateForm
          onSubmit={handleSubmit}
          organizationId={organizationId}
          productId={productId}
          productName={productName}
          returnTo={returnTo}
          pending={pending}
        />
      ) : null}
      <ConsumerClientList
        onRotateSubmit={handleSubmit}
        clients={clients}
        organizationId={organizationId}
        productId={productId}
        returnTo={returnTo}
        pending={pending}
        readOnly={readOnly}
      />
    </>
  );
}
