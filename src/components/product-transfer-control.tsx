"use client";

import { useState } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";
import { useModalDialog } from "@/components/use-modal-dialog";

export function ProductTransferControl({
  productRecordId,
  productId,
  productName,
  destinations,
  pendingDestinationOrganizationId,
  sourceOrganizationId,
}: {
  productRecordId: string;
  productId: string;
  productName: string;
  destinations: Array<{
    organizationId: string;
    name: string;
    disabledReason?: string;
    transferNotice?: string;
  }>;
  pendingDestinationOrganizationId?: string;
  sourceOrganizationId?: string;
}) {
  const [destinationOrganizationId, setDestinationOrganizationId] = useState(
    pendingDestinationOrganizationId ?? "",
  );
  const { dialogRef, openDialog, closeDialog } = useModalDialog();
  const availableDestinations = destinations.filter((destination) => !destination.disabledReason);
  const effectiveDestinationOrganizationId =
    pendingDestinationOrganizationId ?? destinationOrganizationId;
  const selectedDestination = availableDestinations.find(
    (destination) => destination.organizationId === effectiveDestinationOrganizationId,
  );
  const isResumingTransfer = !!pendingDestinationOrganizationId;

  if (!availableDestinations.length) {
    return <span className="form-hint">No organization is available for this transfer.</span>;
  }

  return (
    <form action="/actions/transferProductAction" method="post" className="product-transfer-form">
      <input type="hidden" name="productRecordId" value={productRecordId} />
      {sourceOrganizationId ? (
        <input type="hidden" name="sourceOrganizationId" value={sourceOrganizationId} />
      ) : null}
      {sourceOrganizationId ? <input type="hidden" name="productId" value={productId} /> : null}
      <div className="product-transfer-field">
        <span>Transfer to</span>
        <CustomDropdown
          aria-label="Transfer to organization"
          className="product-transfer-dropdown"
          name="destinationOrganizationId"
          onValueChange={setDestinationOrganizationId}
          options={availableDestinations.map((destination) => ({
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
        disabled={!selectedDestination || !!selectedDestination.disabledReason}
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
          {selectedDestination?.transferNotice
            ? "The destination’s product details and permission sets will be replaced by the current publisher’s. Existing organization members, clients, and API keys remain attached to this product ID. "
            : ""}
          The product keeps ID <code>{productId}</code>. Organizations already using this published
          product keep their setup and access.
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
