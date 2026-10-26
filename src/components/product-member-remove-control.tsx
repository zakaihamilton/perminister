"use client";

import { ConfirmationDialog } from "@/components/confirmation-dialog";

export function ProductMemberRemoveControl({
  organizationId,
  productId,
  subjectId,
  memberLabel,
}: {
  organizationId: string;
  productId: string;
  subjectId: string;
  memberLabel: string;
}) {
  return (
    <ConfirmationDialog
      triggerLabel="Remove member"
      title={`Remove ${memberLabel} from this product?`}
      description="This disables their product membership and permission grants, and revokes their active API keys for this product. You can invite them again later."
    >
      <form action="/actions/removeProductMemberAction" method="post">
        <input name="organizationId" type="hidden" value={organizationId} />
        <input name="productId" type="hidden" value={productId} />
        <input name="subjectId" type="hidden" value={subjectId} />
        <button className="button button-danger" type="submit">
          Remove member
        </button>
      </form>
    </ConfirmationDialog>
  );
}
