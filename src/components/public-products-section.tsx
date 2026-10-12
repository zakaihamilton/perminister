import { ProductTransferControl } from "@/components/product-transfer-control";
import type { AdministratorPublicProductTransferEntry } from "@/lib/auth/service";

export function PublicProductsSection({
  products,
}: {
  products: AdministratorPublicProductTransferEntry[];
}) {
  return (
    <section className="dashboard-card operations-public-products">
      <div className="dashboard-card-heading">
        <div>
          <h2>Shared products</h2>
          <p>Transfer a product’s publisher role to another approved organization.</p>
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
                    {entry.publisherOrganizationName} · used by {entry.adopterCount} other{" "}
                    {entry.adopterCount === 1 ? "organization" : "organizations"}
                  </span>
                </div>
                <span
                  className={`record-badge ${entry.pendingDestinationOrganizationId ? "pending" : "active"}`}
                >
                  {entry.pendingDestinationOrganizationId ? "Transfer incomplete" : "Shared"}
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
        <p className="empty-list">No shared products are available to transfer.</p>
      )}
    </section>
  );
}
