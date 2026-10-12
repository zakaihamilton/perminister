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
