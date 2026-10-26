"use client";

import { useState, type FormEvent } from "react";
import type { ConsumerClientActionState } from "@/app/actions";
import { ConsumerClientSecretDetails } from "@/components/consumer-client-secret-details";
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
        <ConsumerClientSecretDetails clientId={state.clientId} secret={state.secret} />
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
