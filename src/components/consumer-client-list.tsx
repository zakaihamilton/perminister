"use client";

import { useState, type FormEvent } from "react";
import type { ConsumerClientActionState } from "@/app/actions";
import { ConsumerClientCard } from "@/components/consumer-client-card";
import { ConsumerClientConfirmationDialog } from "@/components/consumer-client-confirmation-dialog";
import type {
  ConsumerClientConfirmation,
  ConsumerClientManagementAction,
} from "@/components/consumer-client-list-types";
import { useModalDialog } from "@/components/use-modal-dialog";
import type { ConsumerClientSummary } from "@/lib/auth/service";

interface ConsumerClientListProps {
  onRotateSubmit: (event: FormEvent<HTMLFormElement>) => Promise<ConsumerClientActionState>;
  onOpenConfirmation: () => void;
  clients: ConsumerClientSummary[];
  organizationId: string;
  productId: string;
  returnTo: string;
  pending: boolean;
  readOnly?: boolean;
}

export function ConsumerClientList({
  onRotateSubmit,
  onOpenConfirmation,
  clients,
  organizationId,
  productId,
  returnTo,
  pending,
  readOnly = false,
}: ConsumerClientListProps) {
  const [confirmation, setConfirmation] = useState<ConsumerClientConfirmation | null>(null);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const selectedClient = clients.find((client) => client.clientId === confirmation?.clientId);

  function requestConfirmation(
    action: ConsumerClientManagementAction,
    client: ConsumerClientSummary,
  ) {
    onOpenConfirmation();
    setRotationError(null);
    setConfirmation({ action, clientId: client.clientId });
    openDialog();
  }

  async function handleRotateConfirmation(event: FormEvent<HTMLFormElement>) {
    const result = await onRotateSubmit(event);
    if (result.secret) {
      setConfirmation(null);
      setRotationError(null);
      closeDialog();
    } else {
      setRotationError(result.error ?? "Perminister could not complete that request.");
    }
  }

  function dismissConfirmation() {
    setConfirmation(null);
    setRotationError(null);
    closeDialog();
  }

  return (
    <section className="dashboard-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Configured clients</h2>
          <p>
            {readOnly
              ? "These app clients are managed by the product publisher and shared across its organizations."
              : "Active credentials can call Perminister for this product."}
          </p>
        </div>
      </div>
      {clients.length ? (
        <div className="record-list">
          {clients.map((client) => (
            <ConsumerClientCard
              client={client}
              key={client.clientId}
              onRequestConfirmation={requestConfirmation}
              readOnly={readOnly}
              returnTo={returnTo}
            />
          ))}
        </div>
      ) : (
        <div className="dashboard-empty-card">
          <h3>No app clients yet</h3>
          <p>
            {readOnly
              ? "The product publisher has not configured an app client yet."
              : "Create a client to connect an application backend to Perminister."}
          </p>
        </div>
      )}
      <ConsumerClientConfirmationDialog
        client={selectedClient}
        confirmation={confirmation}
        dialogRef={dialogRef}
        onDismiss={dismissConfirmation}
        onRotateSubmit={handleRotateConfirmation}
        organizationId={organizationId}
        pending={pending}
        productId={productId}
        returnTo={returnTo}
        rotationError={rotationError}
      />
    </section>
  );
}
