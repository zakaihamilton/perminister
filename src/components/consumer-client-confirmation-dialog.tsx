import { useId, type FormEventHandler, type RefObject } from "react";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import type { ConsumerClientConfirmation } from "@/components/consumer-client-list-types";
import { ConsumerClientFormContextFields } from "@/components/consumer-client-form-context-fields";

export function ConsumerClientConfirmationDialog({
  client,
  confirmation,
  dialogRef,
  onDismiss,
  onRotateSubmit,
  organizationId,
  pending,
  productId,
  returnTo,
  rotationError,
}: {
  client?: ConsumerClientSummary;
  confirmation: ConsumerClientConfirmation | null;
  dialogRef: RefObject<HTMLDialogElement | null>;
  onDismiss: () => void;
  onRotateSubmit: FormEventHandler<HTMLFormElement>;
  organizationId: string;
  pending: boolean;
  productId: string;
  returnTo: string;
  rotationError: string | null;
}) {
  const dialogId = useId();

  return (
    <dialog
      aria-describedby={`${dialogId}-description`}
      aria-labelledby={`${dialogId}-title`}
      className="product-privacy-dialog"
      id={`${dialogId}-dialog`}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      ref={dialogRef}
    >
      {client && confirmation ? (
        <>
          <h2 id={`${dialogId}-title`}>
            {confirmation.action === "rotate"
              ? `Replace ${client.appName}’s secret?`
              : `Revoke ${client.appName}?`}
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
            <button className="button button-secondary" onClick={onDismiss} type="button">
              Cancel
            </button>
            {confirmation.action === "rotate" ? (
              <form
                action="/actions/createOrRotateConsumerClientAction"
                method="post"
                onSubmit={onRotateSubmit}
              >
                <ConsumerClientFormContextFields
                  clientId={client.clientId}
                  organizationId={organizationId}
                  productId={productId}
                  returnTo={returnTo}
                />
                <button className="button button-danger" disabled={pending} type="submit">
                  {pending ? "Rotating…" : "Replace secret"}
                </button>
              </form>
            ) : (
              <form action="/actions/revokeConsumerClientAction" method="post">
                <ConsumerClientFormContextFields
                  clientId={client.clientId}
                  organizationId={organizationId}
                  productId={productId}
                  returnTo={returnTo}
                />
                <button className="button button-danger" type="submit">
                  Revoke app client
                </button>
              </form>
            )}
          </div>
        </>
      ) : null}
    </dialog>
  );
}
