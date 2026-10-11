import Link from "next/link";
import Image from "next/image";
import { ProductIcon } from "@/components/product-icon";
import type { ProductRecord } from "@/lib/auth/domain";

export function OrganizationOverviewMetrics({
  activeKeyCount,
  grantCount,
  managerCount,
  managers,
  organizationId,
  productCount,
}: {
  activeKeyCount: number;
  grantCount: number;
  managerCount: number;
  managers: boolean;
  organizationId: string;
  productCount: number;
}) {
  return (
    <section className="dashboard-metric-grid" aria-label="Workspace summary">
      <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/products`}>
        <span>{managers ? "Products" : "Your products"}</span>
        <strong>{productCount}</strong>
        <small>{managers ? "View product catalog" : "View assigned products"}</small>
      </Link>
      <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/products`}>
        <span>{managers ? "Access grants" : "Your grants"}</span>
        <strong>{grantCount}</strong>
        <small>Open a product to review permissions</small>
      </Link>
      <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/api-keys`}>
        <span>Your API keys</span>
        <strong>{activeKeyCount}</strong>
        <small>Manage integrations</small>
      </Link>
      {managers ? (
        <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/people`}>
          <span>People</span>
          <strong>{managerCount}</strong>
          <small>Manage organization members</small>
        </Link>
      ) : null}
    </section>
  );
}

export function OrganizationProductsSection({
  managers,
  organizationId,
  products,
}: {
  managers: boolean;
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
              {managers
                ? "Open a product to manage its members and access."
                : "Open a product to review its details and your access."}
            </p>
          </div>
          <Link className="text-link" href={`/dashboard/${organizationId}/products`}>
            View all
          </Link>
        </div>
        <div className="dashboard-product-preview-list">
          {products.slice(0, 3).map((product) => (
            <Link
              className="dashboard-product-preview"
              href={`/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}`}
              key={product.productRecordId}
            >
              <ProductIcon name={product.name} src={product.iconUrl} />
              <span>
                <strong>{product.name}</strong>
                <small>{product.description || product.websiteUrl}</small>
              </span>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  if (!managers) return null;

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
        <p>Add your first product to start assigning access and creating API keys.</p>
      </div>
      <Link
        className="button button-secondary"
        href={`/dashboard/${organizationId}/products#public-product-catalog`}
      >
        Add existing product
      </Link>
      <Link className="button button-primary" href={`/dashboard/${organizationId}/products/new`}>
        Create a product
      </Link>
    </section>
  );
}

export function OrganizationNextSteps({
  managers,
  organizationId,
}: {
  managers: boolean;
  organizationId: string;
}) {
  return (
    <section className="dashboard-next-steps">
      <h2>Next steps</h2>
      <div className="next-step-grid">
        {managers ? (
          <Link href={`/dashboard/${organizationId}/people`}>
            <span>01</span>
            <strong>Manage catalog managers</strong>
            <small>Control who can edit organization and product details.</small>
          </Link>
        ) : null}
        {managers ? (
          <Link href={`/dashboard/${organizationId}/access`}>
            <span>02</span>
            <strong>Create a product</strong>
            <small>Product members and API actions are managed per product.</small>
          </Link>
        ) : null}
        <Link href={`/dashboard/${organizationId}/api-keys`}>
          <span>03</span>
          <strong>Create an API key</strong>
          <small>Use a key for server-to-server requests.</small>
        </Link>
        <Link href="/developers/getting-started">
          <span>04</span>
          <strong>Read the integration guide</strong>
          <small>Connect your product to Perminister.</small>
        </Link>
      </div>
    </section>
  );
}
