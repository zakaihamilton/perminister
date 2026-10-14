"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { ConsumerClientActionState } from "@/app/actions";
import { CopyAppClientEnvironmentButton } from "@/components/copy-app-client-environment-button";
import { ConsumerClientCreateForm } from "@/components/consumer-client-create-form";
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
        <section className="one-time-secret" aria-live="polite">
          <div className="one-time-secret-heading">
            <strong>Copy these app client details now. The secret will not be shown again.</strong>
            <CopyAppClientEnvironmentButton clientId={state.clientId} secret={state.secret} />
          </div>
          <span>PERMINISTER_APP_CLIENT_ID</span>
          <code>{state.clientId}</code>
          <span>PERMINSITER_APP_CLIENT_SECRET</span>
          <code>{state.secret}</code>
          <p>Store both values in the application backend&apos;s environment.</p>
          <Link className="button button-secondary" href={clientsPath}>
            View app clients
          </Link>
        </section>
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
