import { DashboardNotice } from "@/components/dashboard-shell";

export function ProductPageNotices({
  error,
  isSharedInstallation,
  notice,
}: {
  error?: string;
  isSharedInstallation: boolean;
  notice?: string;
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
      {error === "product-visibility-invalid" ? (
        <DashboardNotice
          message="Choose whether this product should be public or private."
          kind="error"
        />
      ) : null}
      {error === "product-visibility-update" ? (
        <DashboardNotice message="Product availability could not be updated." kind="error" />
      ) : null}
      {isSharedInstallation ? (
        <DashboardNotice message="This shared product’s publisher controls its details and permission sets. Members, permissions, and credentials are specific to this organization." />
      ) : null}
    </>
  );
}
