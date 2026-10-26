"use client";

import { ConfirmationDialog } from "@/components/confirmation-dialog";

export function PermissionGrantDeleteControl({
  membershipId,
  organizationId,
  productId,
  memberLabel,
  scopeLabel,
  accessLabel,
  actionCount,
}: {
  membershipId: string;
  organizationId: string;
  productId: string;
  memberLabel: string;
  scopeLabel: string;
  accessLabel: string;
  actionCount: number;
}) {
  return (
    <ConfirmationDialog
      triggerClassName="button button-danger"
      triggerLabel="Delete permission"
      title="Delete this disabled permission?"
      description={`This permanently removes the ${accessLabel} permission for ${memberLabel} at ${scopeLabel}. It includes ${actionCount} app permission${actionCount === 1 ? "" : "s"}. You can assign permissions again later.`}
    >
      <form action="/actions/deletePermissionGrantAction" method="post">
        <input name="organizationId" type="hidden" value={organizationId} />
        <input name="productId" type="hidden" value={productId} />
        <input name="membershipId" type="hidden" value={membershipId} />
        <button className="button button-danger" type="submit">
          Delete permission
        </button>
      </form>
    </ConfirmationDialog>
  );
}
