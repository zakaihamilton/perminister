import type { FormEventHandler } from "react";
import { AlertDialog } from "panel-frame-ui";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import type { ConsumerClientConfirmation } from "@/components/consumer-client-list-types";
import { ConsumerClientFormContextFields } from "@/components/consumer-client-form-context-fields";

export function ConsumerClientConfirmationDialog({
  client,
  confirmation,
  isOpen,
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
  isOpen: boolean;
  onDismiss: () => void;
  onRotateSubmit: FormEventHandler<HTMLFormElement>;
  organizationId: string;
  pending: boolean;
  productId: string;
  returnTo: string;
  rotationError: string | null;
}) {
  return (
    <AlertDialog
      description={
        confirmation?.action === "rotate"
          ? "The current secret will stop working immediately. Update the app backend with the new secret before it makes another request. The new secret will only be shown once."
          : "This app client will immediately lose access to Perminister. Its client ID and secret will stop working, and this action cannot be undone."
      }
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
      open={isOpen}
      title={
        client && confirmation?.action === "rotate"
          ? `Replace ${client.appName}’s secret?`
          : client
            ? `Revoke ${client.appName}?`
            : "Manage app client"
      }
    >
      {client && confirmation ? (
        <>
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
    </AlertDialog>
  );
}
