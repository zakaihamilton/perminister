"use client";

import { AlertDialog } from "panel-frame-ui";
import { useState } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";
import { useModalDialog } from "@/components/use-modal-dialog";

type ProductRelocationDestination = {
  organizationId: string;
  name: string;
  disabledReason?: string;
  transferNotice?: string;
};

export function ProductRelocationControl({
  mode,
  productRecordId,
  productId,
  productName,
  destinations,
  pendingDestinationOrganizationId,
  sourceOrganizationId,
  operationsOrganizationId,
}: {
  mode: "move" | "transfer";
  productRecordId: string;
  productId: string;
  productName: string;
  destinations: ProductRelocationDestination[];
  pendingDestinationOrganizationId?: string;
  sourceOrganizationId?: string;
  operationsOrganizationId?: string;
}) {
  const isMoving = mode === "move";
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
  const isResuming = !!pendingDestinationOrganizationId;

  if (!availableDestinations.length) {
    return (
      <span className="form-hint">
        {isMoving
          ? "No eligible destination organization is available."
          : "No organization is available for this transfer."}
      </span>
    );
  }

  const resumeIntro = isResuming ? `This will finish the interrupted ${mode}. ` : "";
  const transferNotice =
    !isMoving && selectedDestination?.transferNotice
      ? "The destination’s product details and permission sets will be replaced by the current publisher’s. Existing organization members, clients, and API keys remain attached to this product ID. "
      : "";
  const description = isMoving
    ? `${resumeIntro}The product will leave the source organization. Product members and permissions, invitations, app clients, integrations, and product-scoped API keys will move with it. Organization members and organization-scoped keys stay where they are. The product stays private, and its product ID and app client credentials remain the same.`
    : `${resumeIntro}${transferNotice}The product keeps ID ${productId}. Organizations already using this published product keep their setup and access.`;

  return (
    <form
      action={isMoving ? "/actions/moveProductAction" : "/actions/transferProductAction"}
      method="post"
      className="product-transfer-form"
    >
      <input type="hidden" name="productRecordId" value={productRecordId} />
      {operationsOrganizationId ? (
        <input
          type="hidden"
          name="operationsOrganizationId"
          value={operationsOrganizationId}
        />
      ) : null}
      {sourceOrganizationId ? (
        <>
          <input type="hidden" name="sourceOrganizationId" value={sourceOrganizationId} />
          <input type="hidden" name="productId" value={productId} />
        </>
      ) : null}
      <div className="product-transfer-field">
        <span>{isMoving ? "Move to organization" : "Transfer to"}</span>
        <CustomDropdown
          aria-label={isMoving ? "Move to organization" : "Transfer to organization"}
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
        {isMoving
          ? isResuming
            ? "Resume move"
            : "Move product"
          : isResuming
            ? "Resume transfer"
            : "Transfer publisher"}
      </button>
      <AlertDialog
        description={description}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        open={isOpen}
        title={
          isMoving
            ? isResuming
              ? `Resume moving ${productName} to ${selectedDestination?.name}?`
              : `Move ${productName} to ${selectedDestination?.name}?`
            : isResuming
              ? `Resume transfer of ${productName} to ${selectedDestination?.name}?`
              : `Transfer ${productName} to ${selectedDestination?.name}?`
        }
      >
        <div className="product-privacy-dialog-actions">
          <button className="button button-secondary" type="button" onClick={closeDialog}>
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            {isMoving
              ? isResuming
                ? "Resume move"
                : "Confirm move"
              : isResuming
                ? "Resume transfer"
                : "Confirm transfer"}
          </button>
        </div>
      </AlertDialog>
    </form>
  );
}
