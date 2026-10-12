"use client";

import { useActionState } from "react";
import { createOrRotateConsumerClientAction, type ConsumerClientActionState } from "@/app/actions";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import { ConsumerClientCreateForm } from "@/components/consumer-client-create-form";
import { ConsumerClientList } from "@/components/consumer-client-list";

interface ConsumerClientManagerProps {
  organizationId: string;
  productId: string;
  productName: string;
  returnTo: string;
  clients: ConsumerClientSummary[];
}

export function ConsumerClientManager({
  organizationId,
  productId,
  productName,
  returnTo,
  clients,
}: ConsumerClientManagerProps) {
  const [state, action, pending] = useActionState<ConsumerClientActionState, FormData>(
    createOrRotateConsumerClientAction,
    {},
  );

  return (
    <>
      {state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.clientId && state.secret ? (
        <section className="one-time-secret" aria-live="polite">
          <strong>Copy these app client details now. The secret will not be shown again.</strong>
          <span>Client ID</span>
          <code>{state.clientId}</code>
          <span>Client secret</span>
          <code>{state.secret}</code>
          <p>Store both values in the application backend&apos;s environment.</p>
        </section>
      ) : null}
      <ConsumerClientCreateForm
        action={action}
        organizationId={organizationId}
        productId={productId}
        productName={productName}
        returnTo={returnTo}
        pending={pending}
      />
      <ConsumerClientList
        action={action}
        clients={clients}
        organizationId={organizationId}
        productId={productId}
        returnTo={returnTo}
        pending={pending}
      />
    </>
  );
}
