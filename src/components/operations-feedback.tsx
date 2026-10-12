import { DashboardNotice } from "@/components/dashboard-shell";
import type { OperationsQuery } from "./operations-types";

const productTransferErrors = new Set([
  "Only a public publisher product can be transferred.",
  "Choose a different destination organization.",
  "Choose an approved destination organization.",
  "The destination already has a product with this product ID.",
  "This product has an incomplete transfer. Resume it at its existing destination first.",
  "The previous transfer cannot be resumed safely.",
]);

export function OperationsFeedback({ query }: { query: OperationsQuery }) {
  return (
    <>
      {query.error === "migration" ? (
        <DashboardNotice
          message="Legacy access could not be retired. Check storage and retry."
          kind="error"
        />
      ) : null}
      {query.retired ? (
        <DashboardNotice
          message={`Migration complete: disabled ${query.retired.split(",")[0]} unscoped grants and revoked ${query.retired.split(",")[1] ?? 0} unscoped keys.`}
          kind="success"
        />
      ) : null}
      {query.notice === "account-updated" ? (
        <DashboardNotice message="Account status updated." kind="success" />
      ) : null}
      {query.notice === "account-deleted" ? (
        <DashboardNotice message="Account deleted." kind="success" />
      ) : null}
      {query.error === "account-update-failed" ? (
        <DashboardNotice message="Account status could not be updated." kind="error" />
      ) : null}
      {query.error === "account-delete-owner" ? (
        <DashboardNotice
          message="Transfer this account’s organization and product ownership to another active owner before deleting it."
          kind="error"
        />
      ) : null}
      {query.error === "account-delete-failed" ? (
        <DashboardNotice
          message="Account could not be deleted. Check storage and retry."
          kind="error"
        />
      ) : null}
      {query.error === "organization-review" ? (
        <DashboardNotice
          message="That organization request could not be reviewed. It may already have a decision."
          kind="error"
        />
      ) : null}
      {query.notice === "organization-approved" ? (
        <DashboardNotice message="Organization approved." kind="success" />
      ) : null}
      {query.notice === "organization-rejected" ? (
        <DashboardNotice message="Organization request rejected." kind="success" />
      ) : null}
      {query.notice === "product-transferred" ? (
        <DashboardNotice message="Public product ownership transferred." kind="success" />
      ) : null}
      {query.error === "product-transfer" ? (
        <DashboardNotice
          message={
            query.reason && productTransferErrors.has(query.reason)
              ? query.reason
              : "Public product ownership could not be transferred."
          }
          kind="error"
        />
      ) : null}
    </>
  );
}
