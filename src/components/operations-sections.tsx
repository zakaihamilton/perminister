import { retireLegacyAccessAction, reviewOrganizationRequestAction } from "@/app/actions";
import { AdminAccountActions } from "@/components/admin-account-actions";
import { DashboardNotice } from "@/components/dashboard-shell";
import { ProductTransferControl } from "@/components/product-transfer-control";
import type {
  AdministratorPublicProductTransferEntry,
  OrganizationReviewRequest,
  PublicAccount,
} from "@/lib/auth/service";

export interface OperationsQuery {
  error?: string;
  notice?: string;
  retired?: string;
  reason?: string;
}

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

export function PublicProductsSection({
  products,
}: {
  products: AdministratorPublicProductTransferEntry[];
}) {
  return (
    <section className="dashboard-card operations-public-products">
      <div className="dashboard-card-heading">
        <div>
          <h2>Public products</h2>
          <p>Transfer a product’s public publisher to another approved organization.</p>
        </div>
      </div>
      {products.length ? (
        <div className="record-list">
          {products.map((entry) => (
            <article className="record-item" key={entry.product.productRecordId}>
              <div className="record-item-head">
                <div>
                  <strong>{entry.product.name}</strong>
                  <span className="record-meta">
                    <code>{entry.product.productId}</code> · Published by{" "}
                    {entry.publisherOrganizationName} · {entry.adopterCount} active{" "}
                    {entry.adopterCount === 1 ? "adopter" : "adopters"}
                  </span>
                </div>
                <span
                  className={`record-badge ${entry.pendingDestinationOrganizationId ? "pending" : "active"}`}
                >
                  {entry.pendingDestinationOrganizationId ? "Transfer incomplete" : "Public"}
                </span>
              </div>
              <ProductTransferControl
                productRecordId={entry.product.productRecordId}
                productId={entry.product.productId}
                productName={entry.product.name}
                destinations={entry.destinations}
                pendingDestinationOrganizationId={entry.pendingDestinationOrganizationId}
              />
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-list">No public products are available to transfer.</p>
      )}
    </section>
  );
}

export function OrganizationRequestsSection({
  organizations,
}: {
  organizations: OrganizationReviewRequest[];
}) {
  return (
    <section className="dashboard-card operations-organizations">
      <div className="dashboard-card-heading">
        <div>
          <h2>Organization requests</h2>
          <p>{organizations.length} waiting for review</p>
        </div>
      </div>
      {organizations.length ? (
        <div className="record-list">
          {organizations.map((organization) => (
            <article className="record-item" key={organization.organizationId}>
              <div className="record-item-head">
                <div>
                  <strong>{organization.name}</strong>
                  <span className="record-meta">
                    {organization.requesterEmail ?? "Requester email unavailable"} · Submitted{" "}
                    {new Date(organization.createdAt).toLocaleString()}
                  </span>
                </div>
                <span className="record-badge pending">Pending</span>
              </div>
              <div className="record-actions">
                <form action={reviewOrganizationRequestAction}>
                  <input type="hidden" name="organizationId" value={organization.organizationId} />
                  <input type="hidden" name="approvalStatus" value="approved" />
                  <button className="button button-primary" type="submit">
                    Approve
                  </button>
                </form>
                <form action={reviewOrganizationRequestAction}>
                  <input type="hidden" name="organizationId" value={organization.organizationId} />
                  <input type="hidden" name="approvalStatus" value="rejected" />
                  <button className="button button-secondary" type="submit">
                    Reject
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-list">No organization requests are waiting for review.</p>
      )}
    </section>
  );
}

export function LegacyAccessSection({ legacy }: { legacy: { grants: number; keys: number } }) {
  return (
    <section className="dashboard-card operations-migration">
      <div>
        <h2>Retire legacy access</h2>
        <p>
          This disables grants and revokes API keys that do not belong to an organization.
          Identities, sessions, and audit history are preserved. The operation is safe to repeat.
        </p>
      </div>
      <div className="migration-counts">
        <span>
          <strong>{legacy.grants}</strong> active grants
        </span>
        <span>
          <strong>{legacy.keys}</strong> active API keys
        </span>
      </div>
      {legacy.grants || legacy.keys ? (
        <form action={retireLegacyAccessAction}>
          <button className="button button-primary" type="submit">
            Disable legacy access
          </button>
        </form>
      ) : (
        <p className="form-hint">No active unscoped grants or keys remain.</p>
      )}
    </section>
  );
}

export function AccountsSection({ accounts }: { accounts: PublicAccount[] }) {
  return (
    <section className="dashboard-card operations-accounts">
      <div className="dashboard-card-heading">
        <div>
          <h2>Accounts</h2>
          <p>{accounts.length} registered accounts</p>
        </div>
      </div>
      <div className="record-list">
        {accounts.map((account) => (
          <article className="record-item admin-account-row" key={account.subjectId}>
            <p>
              {account.email ?? "No email"}
              <span>
                {account.status} · {account.emailVerified ? "verified" : "not verified"}
                {account.administrator ? " · platform administrator" : ""}
              </span>
            </p>
            {!account.administrator ? (
              <AdminAccountActions
                subjectId={account.subjectId}
                email={account.email}
                status={account.status}
              />
            ) : (
              <span className="record-badge active">Restricted admin</span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
