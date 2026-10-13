import { DashboardNotice } from "@/components/dashboard-shell";

const productTransferErrorMessages = new Set([
  "Only a public publisher product can be transferred.",
  "Choose a different destination organization.",
  "Choose an approved destination organization.",
  "The destination already has a product with this product ID.",
  "This product has an incomplete transfer. Resume it at its existing destination first.",
  "The previous transfer cannot be resumed safely.",
  "You do not have permission to manage this organization.",
]);

export function ProductPageNotices({
  error,
  isSharedInstallation,
  notice,
  reason,
}: {
  error?: string;
  isSharedInstallation: boolean;
  notice?: string;
  reason?: string;
}) {
  return (
    <>
      {notice === "product-created" ? (
        <DashboardNotice
          message="Product created. Next, connect the app, invite product members, and assign permissions."
          kind="success"
        />
      ) : null}
      {notice === "product-updated" ? (
        <DashboardNotice message="Product details saved." kind="success" />
      ) : null}
      {notice === "product-added" ? (
        <DashboardNotice
          message="Shared product added. Manage its members, permissions, and credentials in this organization."
          kind="success"
        />
      ) : null}
      {notice === "product-visibility-updated" ? (
        <DashboardNotice message="Product availability updated." kind="success" />
      ) : null}
      {notice === "product-transferred" ? (
        <DashboardNotice
          message="Publisher role transferred to this organization."
          kind="success"
        />
      ) : null}
      {error === "product-visibility-invalid" ? (
        <DashboardNotice
          message="Choose whether this product should be public or private."
          kind="error"
        />
      ) : null}
      {error === "product-visibility-update" ? (
        <DashboardNotice message="Product availability could not be updated." kind="error" />
      ) : null}
      {error === "product-transfer" ? (
        <DashboardNotice
          message={
            reason && productTransferErrorMessages.has(reason)
              ? reason
              : "Could not transfer the publisher role. Make sure you own both organizations and the product is shared."
          }
          kind="error"
        />
      ) : null}
      {isSharedInstallation ? (
        <DashboardNotice message="This shared product’s publisher controls its details and permission sets. Members, permissions, and credentials are specific to this organization." />
      ) : null}
    </>
  );
}
