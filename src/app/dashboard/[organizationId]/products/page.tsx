import Link from "next/link";
import Image from "next/image";
import { ProductIcon } from "@/components/product-icon";
import { addPublicProductAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listPublicProductsForOrganization,
  listProductsForOrganization,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const [organization, products] = await Promise.all([
    getOrganizationForSubject(current.subject.subjectId, organizationId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
  ]);
  const canManage =
    organization.catalogManager &&
    (organization.membership.role === "owner" || organization.membership.role === "admin");
  const publicProducts = canManage
    ? await listPublicProductsForOrganization(current.subject.subjectId, organizationId)
    : [];
  return (
    <>
      <DashboardHeading
        description="Manage the products in this organization and the access attached to each one."
        action={
          canManage ? (
            <Link
              className="button button-primary"
              href={`/dashboard/${organizationId}/products/new`}
            >
              Create product
            </Link>
          ) : undefined
        }
      />
      {query.notice === "product-updated" ? (
        <DashboardNotice message="Product details saved." kind="success" />
      ) : null}
      {query.error === "product-update" ? (
        <DashboardNotice message="Product details could not be saved." kind="error" />
      ) : null}
      {query.error ===
      "A different product with this ID already exists in this organization. Resolve that conflict before adding the shared product." ? (
        <DashboardNotice message={query.error} kind="error" />
      ) : null}
      {query.error === "This public product is no longer available." ? (
        <DashboardNotice message={query.error} kind="error" />
      ) : null}
      {query.error === "Perminister could not complete that request." ? (
        <DashboardNotice
          message="Product setup did not finish. If the product is marked setup required below, retry setup there."
          kind="error"
        />
      ) : null}
      {products.length ? (
        <div className="product-catalog">
          {products.map((product) => (
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
                <span
                  className={`record-badge product-visibility-badge ${
                    product.sharedProductRef || product.visibility === "public" ? "active" : ""
                  }`}
                >
                  {product.sharedProductRef
                    ? "Shared product"
                    : product.visibility === "public"
                      ? "Public"
                      : "Private"}
                </span>
              </span>
              <span className="product-card-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          ))}
        </div>
      ) : (
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
            <h2>Your product catalog starts here</h2>
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
      )}
      {canManage ? (
        <section className="dashboard-card public-product-catalog">
          <div className="dashboard-card-heading">
            <div>
              <h2>Public product catalog</h2>
              <p>
                Add a shared product to this organization. Its publisher manages shared details.
              </p>
            </div>
          </div>
          {publicProducts.length ? (
            <div className="public-product-list">
              {publicProducts.map(({ product, publisherOrganizationName, status }) => (
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
                  ) : status === "conflict" ? (
                    <span className="public-product-conflict">
                      Another product already uses this ID
                    </span>
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
            <p className="empty-list">No public products are available to add right now.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
