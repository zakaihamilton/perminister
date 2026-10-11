"use client";

import { useState } from "react";
import { transferPublicProductAction } from "@/app/actions";
import { useModalDialog } from "@/components/use-modal-dialog";

export function ProductTransferControl({
  productRecordId,
  productId,
  productName,
  destinations,
  pendingDestinationOrganizationId,
}: {
  productRecordId: string;
  productId: string;
  productName: string;
  destinations: Array<{ organizationId: string; name: string }>;
  pendingDestinationOrganizationId?: string;
}) {
  const [destinationOrganizationId, setDestinationOrganizationId] = useState(
    pendingDestinationOrganizationId ?? "",
  );
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const effectiveDestinationOrganizationId =
    pendingDestinationOrganizationId ?? destinationOrganizationId;
  const selectedDestination = destinations.find(
    (destination) => destination.organizationId === effectiveDestinationOrganizationId,
  );
  const isResumingTransfer = !!pendingDestinationOrganizationId;

  if (!destinations.length) {
    return (
      <span className="form-hint">No approved destination without a product ID conflict.</span>
    );
  }

  return (
    <form action={transferPublicProductAction} className="product-transfer-form">
      <input type="hidden" name="productRecordId" value={productRecordId} />
      <label>
        Transfer to
        <select
          name="destinationOrganizationId"
          value={effectiveDestinationOrganizationId}
          onChange={(event) => setDestinationOrganizationId(event.target.value)}
          required
        >
          <option value="">Choose an organization</option>
          {destinations.map((destination) => (
            <option key={destination.organizationId} value={destination.organizationId}>
              {destination.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button button-secondary"
        type="button"
        disabled={!selectedDestination}
        onClick={openDialog}
      >
        {isResumingTransfer ? "Resume transfer" : "Transfer owner"}
      </button>
      <dialog
        className="product-privacy-dialog"
        ref={dialogRef}
        aria-labelledby="product-transfer-dialog-title"
        aria-describedby="product-transfer-dialog-description"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
      >
        <h2 id="product-transfer-dialog-title">
          {isResumingTransfer
            ? `Resume transfer of ${productName} to ${selectedDestination?.name}?`
            : `Transfer ${productName} to ${selectedDestination?.name}?`}
        </h2>
        <p id="product-transfer-dialog-description">
          {isResumingTransfer ? "This will finish the interrupted transfer. " : ""}
          The product stays public with ID <code>{productId}</code>. Existing adopter setup and
          access remain in their organizations.
        </p>
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" type="button" onClick={closeDialog}>
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            {isResumingTransfer ? "Resume transfer" : "Confirm transfer"}
          </button>
        </div>
      </dialog>
    </form>
  );
}
