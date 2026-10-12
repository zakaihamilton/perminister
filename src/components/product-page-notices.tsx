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
          message="Product created. Next, connect the app, invite people, and assign access."
          kind="success"
        />
      ) : null}
      {notice === "product-updated" ? (
        <DashboardNotice message="Product details saved." kind="success" />
      ) : null}
      {notice === "product-added" ? (
        <DashboardNotice
          message="Shared product added. Its members, access grants, and credentials are managed in this organization."
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
        <DashboardNotice message="This is a shared product. The publisher controls its details and access roles; people, grants, and credentials remain specific to this organization." />
      ) : null}
    </>
  );
}
