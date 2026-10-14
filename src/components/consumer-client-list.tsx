"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import type { ConsumerClientActionState } from "@/app/actions";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import { useModalDialog } from "@/components/use-modal-dialog";

const createdDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

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

function sessionLifetimeLabel(milliseconds: number): string {
  const hours = milliseconds / (60 * 60 * 1000);
  if (hours % 24 === 0) {
    const days = hours / 24;
    const dayLabel = days === 1 ? "day" : "days";
    const hourLabel = hours === 1 ? "hour" : "hours";
    return `${days} ${dayLabel} (${hours} ${hourLabel})`;
  }
  if (Number.isInteger(hours)) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const minutes = milliseconds / (60 * 1000);
  if (Number.isInteger(minutes) && minutes < 60) {
    const roundedHours = Number(hours.toFixed(2));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} (${roundedHours} hours)`;
  }
  return `${Number(hours.toFixed(2))} hours`;
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
  const [confirmation, setConfirmation] = useState<{
    action: "rotate" | "revoke";
    clientId: string;
  } | null>(null);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const dialogId = useId();
  const selectedClient = clients.find((client) => client.clientId === confirmation?.clientId);

  function requestConfirmation(action: "rotate" | "revoke", client: ConsumerClientSummary) {
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
            <article className="consumer-client-card" key={client.clientId}>
              <div className="consumer-client-card-heading">
                <div>
                  <h3>{client.appName}</h3>
                  <p>
                    Client ID <code>{client.clientId}</code>
                  </p>
                </div>
                <span className={`record-badge ${client.status}`}>
                  {client.status === "active" ? "Active" : "Revoked"}
                </span>
              </div>
              <dl className="consumer-client-details-grid">
                <div>
                  <dt>Allowed origin</dt>
                  <dd>{client.appOrigin ?? "Not set"}</dd>
                </div>
                <div>
                  <dt>Session lifetime</dt>
                  <dd>{sessionLifetimeLabel(client.sessionLifetimeMs)}</dd>
                </div>
                <div>
                  <dt>People can sign up</dt>
                  <dd>{client.selfRegistrationEnabled ? "Enabled" : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    <time dateTime={client.createdAt}>
                      {createdDateFormatter.format(new Date(client.createdAt))}
                    </time>
                  </dd>
                </div>
              </dl>
              {!readOnly && client.status === "active" ? (
                <div className="consumer-client-card-actions">
                  <div className="consumer-client-card-buttons">
                    <Link
                      className="button button-secondary"
                      href={`${returnTo}/${encodeURIComponent(client.clientId)}/edit`}
                    >
                      Edit settings
                    </Link>
                    <button
                      aria-haspopup="dialog"
                      className="button button-secondary"
                      onClick={() => requestConfirmation("rotate", client)}
                      type="button"
                    >
                      Rotate secret
                    </button>
                    <button
                      aria-haspopup="dialog"
                      className="button button-danger"
                      onClick={() => requestConfirmation("revoke", client)}
                      type="button"
                    >
                      Revoke app client
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
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
      <dialog
        aria-describedby={`${dialogId}-description`}
        aria-labelledby={`${dialogId}-title`}
        className="product-privacy-dialog"
        id={`${dialogId}-dialog`}
        onCancel={(event) => {
          event.preventDefault();
          dismissConfirmation();
        }}
        ref={dialogRef}
      >
        {selectedClient && confirmation ? (
          <>
            <h2 id={`${dialogId}-title`}>
              {confirmation.action === "rotate"
                ? `Replace ${selectedClient.appName}’s secret?`
                : `Revoke ${selectedClient.appName}?`}
            </h2>
            <p id={`${dialogId}-description`}>
              {confirmation.action === "rotate"
                ? "The current secret will stop working immediately. Update the app backend with the new secret before it makes another request. The new secret will only be shown once."
                : "This app client will immediately lose access to Perminister. Its client ID and secret will stop working, and this action cannot be undone."}
            </p>
            {rotationError ? (
              <p className="form-error" role="alert">
                {rotationError}
              </p>
            ) : null}
            <div className="product-privacy-dialog-actions">
              <button
                className="button button-secondary"
                onClick={dismissConfirmation}
                type="button"
              >
                Cancel
              </button>
              {confirmation.action === "rotate" ? (
                <form
                  action="/actions/createOrRotateConsumerClientAction"
                  method="post"
                  onSubmit={handleRotateConfirmation}
                >
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="clientId" value={selectedClient.clientId} />
                  <button className="button button-danger" disabled={pending} type="submit">
                    {pending ? "Rotating…" : "Replace secret"}
                  </button>
                </form>
              ) : (
                <form action="/actions/revokeConsumerClientAction" method="post">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="clientId" value={selectedClient.clientId} />
                  <button className="button button-danger" type="submit">
                    Revoke app client
                  </button>
                </form>
              )}
            </div>
          </>
        ) : null}
      </dialog>
    </section>
  );
}
