"use client";

import { AlertDialog } from "panel-frame-ui";
import { useState } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";
import { useModalDialog } from "@/components/use-modal-dialog";

export function ProductMoveControl({
  productRecordId,
  productId,
  productName,
  sourceOrganizationId,
  destinations,
  pendingDestinationOrganizationId,
}: {
  productRecordId: string;
  productId: string;
  productName: string;
  sourceOrganizationId: string;
  destinations: Array<{
    organizationId: string;
    name: string;
    disabledReason?: string;
  }>;
  pendingDestinationOrganizationId?: string;
}) {
  const [destinationOrganizationId, setDestinationOrganizationId] = useState(
    pendingDestinationOrganizationId ?? "",
  );
  const { isOpen, openDialog, closeDialog } = useModalDialog();
  const availableDestinations = destinations.filter((destination) => !destination.disabledReason);
  const effectiveDestinationOrganizationId =
    pendingDestinationOrganizationId ?? destinationOrganizationId;
  const selectedDestination = availableDestinations.find(
    (destination) => destination.organizationId === effectiveDestinationOrganizationId,
  );
  const isResumingMove = !!pendingDestinationOrganizationId;

  if (!availableDestinations.length) {
    return <span className="form-hint">No eligible destination organization is available.</span>;
  }

  return (
    <form action="/actions/moveProductAction" method="post" className="product-transfer-form">
      <input type="hidden" name="productRecordId" value={productRecordId} />
      <input type="hidden" name="sourceOrganizationId" value={sourceOrganizationId} />
      <input type="hidden" name="productId" value={productId} />
      <div className="product-transfer-field">
        <span>Move to organization</span>
        <CustomDropdown
          aria-label="Move to organization"
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
        disabled={!selectedDestination}
        onClick={openDialog}
      >
        {isResumingMove ? "Resume move" : "Move product"}
      </button>
      <AlertDialog
        description={
          `${isResumingMove ? "This will finish the interrupted move. " : ""}` +
          "The product will leave the source organization. Product members and permissions, invitations, app clients, integrations, and product-scoped API keys will move with it. Organization members and organization-scoped keys stay where they are. The product stays private, and its product ID and app client credentials remain the same."
        }
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        open={isOpen}
        title={
          isResumingMove
            ? `Resume moving ${productName} to ${selectedDestination?.name}?`
            : `Move ${productName} to ${selectedDestination?.name}?`
        }
      >
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" type="button" onClick={closeDialog}>
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            {isResumingMove ? "Resume move" : "Confirm move"}
          </button>
        </div>
      </AlertDialog>
    </form>
  );
}
