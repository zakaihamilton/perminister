"use client";

import { ProductRelocationControl } from "@/components/product-relocation-control";

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
  return (
    <ProductRelocationControl
      mode="move"
      productRecordId={productRecordId}
      productId={productId}
      productName={productName}
      sourceOrganizationId={sourceOrganizationId}
      destinations={destinations}
      pendingDestinationOrganizationId={pendingDestinationOrganizationId}
    />
  );
}
