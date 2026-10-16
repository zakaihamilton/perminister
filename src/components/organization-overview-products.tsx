import Link from "next/link";
import { OrganizationProductBrowser } from "@/components/organization-product-browser";
import type { ProductRecord } from "@/lib/auth/domain";

export function OrganizationCreateProductAction({
  canManage,
  hasProducts,
  organizationId,
}: {
  canManage: boolean;
  hasProducts: boolean;
  organizationId: string;
}) {
  if (!canManage || !hasProducts) return null;

  return (
    <Link className="button button-primary" href={`/dashboard/${organizationId}/products/new`}>
      Create product
    </Link>
  );
}

export function OrganizationProductsSection({
  canManage,
  organizationId,
  products,
}: {
  canManage: boolean;
  organizationId: string;
  products: ProductRecord[];
}) {
  if (products.length) {
    return (
      <section className="dashboard-card dashboard-overview-products">
        <div className="dashboard-card-heading">
          <div>
            <h2>Products</h2>
            <p>
              {canManage
                ? "Open a product to manage its members and permissions."
                : "Open a product to see its details and your permissions."}
            </p>
          </div>
          <Link className="text-link" href={`/dashboard/${organizationId}/products`}>
            View all products
          </Link>
        </div>
        <OrganizationProductBrowser
          canManage={canManage}
          organizationId={organizationId}
          products={products
            .slice(0, 6)
            .map(({ productId, name, description, websiteUrl, iconUrl }) => ({
              productId,
              name,
              description,
              websiteUrl,
              iconUrl,
            }))}
        />
      </section>
    );
  }

  return (
    <section className="dashboard-empty-card organization-products-empty">
      <div>
        <h2>{canManage ? "No products yet" : "No products available"}</h2>
        <p>
          {canManage
            ? "Create a product or add one from the shared catalog. Each product has its own members and permissions."
            : "Ask an organization owner or admin to add you to a product."}
        </p>
      </div>
      {canManage ? (
        <div className="organization-empty-actions">
          <Link
            className="button button-primary"
            href={`/dashboard/${organizationId}/products/new`}
          >
            Create product
          </Link>
          <Link
            className="button button-secondary"
            href={`/dashboard/${organizationId}/products#public-product-catalog`}
          >
            Browse shared products
          </Link>
        </div>
      ) : null}
    </section>
  );
}
