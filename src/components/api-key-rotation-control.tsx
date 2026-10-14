"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiKeyForm } from "@/components/api-key-form";
import { useModalDialog } from "@/components/use-modal-dialog";
import type { ApiKeyRecord, ProductRecord } from "@/lib/auth/domain";

export function ApiKeyRotationControl({
  apiKey,
  organizationId,
  product,
  returnTo,
}: {
  apiKey: ApiKeyRecord;
  organizationId: string;
  product: ProductRecord;
  returnTo: string;
}) {
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const dialogId = useId();
  const router = useRouter();
  const [rotated, setRotated] = useState(false);

  function openRotationDialog() {
    setRotated(false);
    openDialog();
  }

  function closeRotationDialog() {
    closeDialog();
    if (rotated) router.refresh();
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="button button-secondary"
        onClick={openRotationDialog}
        type="button"
      >
        Rotate this key
      </button>
      <dialog
        aria-describedby={`${dialogId}-description`}
        aria-labelledby={`${dialogId}-title`}
        className="product-privacy-dialog api-key-rotation-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeRotationDialog();
        }}
        ref={dialogRef}
      >
        <h2 id={`${dialogId}-title`}>Rotate this API key?</h2>
        <p id={`${dialogId}-description`}>
          Creating a replacement will revoke this key. Update any app or script using it with the
          new key as soon as it is created.
        </p>
        <ApiKeyForm
          defaults={{
            scope: apiKey.scope,
            actions: apiKey.actions,
            expiresInDays: apiKey.expiresAt ? "30" : "never",
          }}
          onCancel={closeRotationDialog}
          onSuccess={() => setRotated(true)}
          organizationId={organizationId}
          products={[product]}
          returnTo={returnTo}
          rotateFromApiKeyId={apiKey.apiKeyId}
          submitLabel="Create replacement key"
        />
      </dialog>
    </>
  );
}
