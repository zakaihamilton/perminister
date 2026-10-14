"use client";

import { useState, type FormEvent } from "react";
import type { ConsumerClientActionState } from "@/app/actions";
import { submitStableAction } from "@/lib/action-client";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import { ConsumerClientList } from "@/components/consumer-client-list";

interface ConsumerClientManagerProps {
  organizationId: string;
  productId: string;
  returnTo: string;
  clients: ConsumerClientSummary[];
  readOnly?: boolean;
}

export function ConsumerClientManager({
  organizationId,
  productId,
  returnTo,
  clients,
  readOnly = false,
}: ConsumerClientManagerProps) {
  const [state, setState] = useState<ConsumerClientActionState>({});
  const [pending, setPending] = useState(false);

  async function handleRotateSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<ConsumerClientActionState> {
    event.preventDefault();
    setPending(true);
    try {
      const result = await submitStableAction<ConsumerClientActionState>(
        "createOrRotateConsumerClientAction",
        new FormData(event.currentTarget),
      );
      if (result.secret) setState(result);
      else setState((current) => ({ ...current, error: undefined }));
      return result;
    } catch (error) {
      setState((current) => ({ ...current, error: undefined }));
      return { error: error instanceof Error ? error.message : "Please try again." };
    } finally {
      setPending(false);
    }
  }

  return (
    <>
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
      <ConsumerClientList
        onRotateSubmit={handleRotateSubmit}
        onOpenConfirmation={() => setState((current) => ({ ...current, error: undefined }))}
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
