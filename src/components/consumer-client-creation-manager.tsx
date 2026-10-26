"use client";

import { useState, type FormEvent } from "react";
import type { ConsumerClientActionState } from "@/app/actions";
import { ConsumerClientCreateForm } from "@/components/consumer-client-create-form";
import { ConsumerClientSecretDetails } from "@/components/consumer-client-secret-details";
import { submitStableAction } from "@/lib/action-client";

export function ConsumerClientCreationManager({
  organizationId,
  productId,
  productName,
  returnTo,
  clientsPath,
}: {
  organizationId: string;
  productId: string;
  productName: string;
  returnTo: string;
  clientsPath: string;
}) {
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
      {state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.clientId && state.secret ? (
        <ConsumerClientSecretDetails
          clientId={state.clientId}
          secret={state.secret}
          clientsPath={clientsPath}
        />
      ) : null}
      <ConsumerClientCreateForm
        onSubmit={handleSubmit}
        organizationId={organizationId}
        productId={productId}
        productName={productName}
        returnTo={returnTo}
        pending={pending}
      />
    </>
  );
}
