"use client";

import { useState } from "react";
import { transferPublicProductAction } from "@/app/actions";
import { CustomDropdown } from "@/components/custom-dropdown";
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
      <span className="form-hint">No eligible organization is available for this transfer.</span>
    );
  }

  return (
    <form action={transferPublicProductAction} className="product-transfer-form">
      <input type="hidden" name="productRecordId" value={productRecordId} />
      <div className="product-transfer-field">
        <span>Transfer to</span>
        <CustomDropdown
          aria-label="Transfer to organization"
          className="product-transfer-dropdown"
          name="destinationOrganizationId"
          onValueChange={setDestinationOrganizationId}
          options={destinations.map((destination) => ({
            value: destination.organizationId,
            label: destination.name,
          }))}
          placeholder="Choose an organization"
          required
          value={effectiveDestinationOrganizationId}
        />
      </div>
      <button
        className="button button-secondary"
        type="button"
        disabled={!selectedDestination}
        onClick={openDialog}
      >
        {isResumingTransfer ? "Resume transfer" : "Transfer publisher"}
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
          The product stays shared with ID <code>{productId}</code>. Existing organizations keep
          their product setup and access.
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
