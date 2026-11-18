"use client";

import { ProductRelocationControl } from "@/components/product-relocation-control";

export function ProductTransferControl({
  productRecordId,
  productId,
  productName,
  destinations,
  pendingDestinationOrganizationId,
  sourceOrganizationId,
  operationsOrganizationId,
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
  operationsOrganizationId?: string;
}) {
  return (
    <ProductRelocationControl
      mode="transfer"
      productRecordId={productRecordId}
      productId={productId}
      productName={productName}
      destinations={destinations}
      pendingDestinationOrganizationId={pendingDestinationOrganizationId}
      sourceOrganizationId={sourceOrganizationId}
      operationsOrganizationId={operationsOrganizationId}
    />
  );
}
