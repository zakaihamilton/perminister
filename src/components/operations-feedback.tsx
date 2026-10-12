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
          message="Older access could not be removed. Check storage and try again."
          kind="error"
        />
      ) : null}
      {query.retired ? (
        <DashboardNotice
          message={`Older access removed: disabled ${query.retired.split(",")[0]} permissions and revoked ${query.retired.split(",")[1] ?? 0} API keys not linked to an organization.`}
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
        <DashboardNotice
          message="Shared product transferred to its new publisher."
          kind="success"
        />
      ) : null}
      {query.error === "product-transfer" ? (
        <DashboardNotice
          message={
            query.reason && productTransferErrors.has(query.reason)
              ? query.reason === "Only a public publisher product can be transferred."
                ? "Only a shared product can be transferred."
                : query.reason
              : "Could not transfer the shared product to a new publisher."
          }
          kind="error"
        />
      ) : null}
    </>
  );
}
