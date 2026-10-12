import Link from "next/link";
import Image from "next/image";
import { addPublicProductAction } from "@/app/actions";
import { ProductIcon } from "@/components/product-icon";
import { DashboardNotice } from "@/components/dashboard-shell";
import type { ProductRecord } from "@/lib/auth/domain";
import type { PublicProductCatalogEntry } from "@/lib/auth/service";

export function OrganizationProductNotices({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {notice === "product-updated" ? (
        <DashboardNotice message="Product details saved." kind="success" />
      ) : null}
      {error === "product-update" ? (
        <DashboardNotice message="Product details could not be saved." kind="error" />
      ) : null}
      {error ===
      "A different product with this ID already exists in this organization. Resolve that conflict before adding the shared product." ? (
        <DashboardNotice message={error} kind="error" />
      ) : null}
      {error === "This public product is no longer available." ? (
        <DashboardNotice message="This shared product is no longer available." kind="error" />
      ) : null}
      {error === "Perminister could not complete that request." ? (
        <DashboardNotice
          message="Product setup did not finish. If the product is marked setup required below, retry setup there."
          kind="error"
        />
      ) : null}
    </>
  );
}

export function OrganizationProductCatalog({
  canManage,
  conflictingSharedProducts,
  organizationId,
  products,
}: {
  canManage: boolean;
  conflictingSharedProducts: PublicProductCatalogEntry[];
  organizationId: string;
  products: ProductRecord[];
}) {
  const conflictingProductIds = new Set(
    conflictingSharedProducts.map(({ product }) => product.productId),
  );

  if (!products.length) {
    return (
      <section className="dashboard-empty-card">
        <Image
          alt="A workspace folder ready for its first product and team members."
          className="empty-state-illustration"
          height={1254}
          sizes="88px"
          src="/illustrations/workspace-invitation.png"
          width={1254}
        />
        <div>
          <h2>No products yet</h2>
          <p>Add a website and we’ll suggest the name, description, and icon.</p>
        </div>
        {canManage ? (
          <Link
            className="button button-primary"
            href={`/dashboard/${organizationId}/products/new`}
          >
            Create your first product
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <div className="product-catalog">
      {products.map((product) => {
        const isPublic =
          Boolean(product.sharedProductRef) ||
          product.visibility === "public" ||
          conflictingProductIds.has(product.productId);

        return (
          <Link
            className="product-card"
            href={`/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}`}
            key={product.productRecordId}
          >
            <ProductIcon name={product.name} src={product.iconUrl} />
            <span className="product-card-copy">
              <strong>{product.name}</strong>
              <small>{product.description || product.websiteUrl}</small>
              <code>{product.productId}</code>
              <span className={`record-badge product-visibility-badge ${isPublic ? "active" : ""}`}>
                {isPublic ? "Public" : "Private"}
              </span>
            </span>
            <span className="product-card-arrow" aria-hidden="true">
              ↗
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function PublicProductCatalog({
  organizationId,
  products,
}: {
  organizationId: string;
  products: PublicProductCatalogEntry[];
}) {
  const addableProducts = products.filter((entry) => entry.status !== "conflict");
  const hasConflicts = addableProducts.length !== products.length;

  return (
    <section className="dashboard-card public-product-catalog" id="public-product-catalog">
      <div className="dashboard-card-heading">
        <div>
          <h2>Shared products</h2>
          <p>Add a shared product to this organization. Its publisher manages shared details.</p>
        </div>
      </div>
      {addableProducts.length ? (
        <div className="public-product-list">
          {addableProducts.map(({ product, publisherOrganizationName, status }) => (
            <article className="public-product-item" key={product.productRecordId}>
              <ProductIcon name={product.name} src={product.iconUrl} size={42} />
              <div className="public-product-copy">
                <strong>{product.name}</strong>
                <span>{product.description || product.websiteUrl}</span>
                <small>
                  Published by {publisherOrganizationName} · <code>{product.productId}</code>
                </small>
              </div>
              {status === "installed" ? (
                <span className="record-badge active">Added</span>
              ) : (
                <>
                  {status === "setup-required" ? (
                    <span className="public-product-conflict">
                      Setup incomplete; no product owner is active.
                    </span>
                  ) : null}
                  <form action={addPublicProductAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input
                      type="hidden"
                      name="sourceProductRecordId"
                      value={product.productRecordId}
                    />
                    <button className="button button-secondary" type="submit">
                      {status === "setup-required" ? "Complete setup" : "Add to organization"}
                    </button>
                  </form>
                </>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-list">
          {hasConflicts
            ? "Shared products with IDs already in use are shown with the matching product above."
            : "No shared products are available to add right now."}
        </p>
      )}
    </section>
  );
}
