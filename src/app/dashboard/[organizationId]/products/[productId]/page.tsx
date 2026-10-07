import Link from "next/link";
import { updateOrganizationProductAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ProductIcon } from "@/components/product-icon";
import {
  getProductPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import { listConsumerClientsForProduct } from "@/lib/auth/service";

export default async function ProductPage({ params, searchParams }: ProductPageWithSearchParams) {
  const [{ current, organizationId, productId, access: productAccess }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  const product = productAccess.product;
  const canManageDetails = productAccess.catalogManager;
  const productRole = productAccess.membership?.role;
  const canManageProduct = productRole === "owner" || productRole === "admin";
  const productClients = canManageProduct
    ? await listConsumerClientsForProduct(
        current.subject.subjectId,
        organizationId,
        product.productId,
      )
    : [];
  const connectedClients = productClients.filter((client) => client.status === "active");
  const productActionLinks = canManageProduct
    ? [
        { path: "people", label: "People" },
        { path: "access", label: "Access" },
        { path: "roles", label: "Access roles" },
        { path: "clients", label: "App clients" },
        { path: "api-keys", label: "API keys" },
        { path: "activity", label: "Activity" },
      ]
    : productRole === "member"
      ? [
          { path: "access", label: "My access" },
          { path: "api-keys", label: "API keys" },
          { path: "activity", label: "Activity" },
        ]
      : [];
  return (
    <>
      <DashboardHeading
        description={product.description || "Product details and stable integration ID."}
        action={
          productActionLinks.length ? (
            <div className="product-detail-actions">
              {productActionLinks.map((link) => (
                <Link
                  className="button button-secondary"
                  href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/${link.path}`}
                  key={link.path}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      />
      {query.notice === "product-created" ? (
        <DashboardNotice
          message="Product created. Next, connect the app, invite people, and assign access."
          kind="success"
        />
      ) : null}
      {query.notice === "product-updated" ? (
        <DashboardNotice message="Product details saved." kind="success" />
      ) : null}
      {canManageProduct ? (
        <section className="dashboard-card product-onboarding-card">
          <div className="dashboard-card-heading">
            <div>
              <h2>Set up your application</h2>
              <p>
                Perminister handles sign-in and organization membership. Your app keeps its own data
                and checks each person&apos;s access grants before allowing access to protected
                resources.
              </p>
            </div>
          </div>
          <ol className="product-onboarding-steps">
            <li>
              <span className="onboarding-step">01</span>
              <div>
                <div className="product-onboarding-step-heading">
                  <h3>Connect the app</h3>
                  <span
                    className={`record-badge ${connectedClients.length ? "active" : "pending"}`}
                  >
                    {connectedClients.length ? "Credentials set" : "Next step"}
                  </span>
                </div>
                {connectedClients.length === 1 ? (
                  <p>
                    {connectedClients[0].appName} has active credentials for product ID{" "}
                    <code>{product.productId}</code>. Keep the client secret in the app
                    backend&apos;s environment. Reuse this client across organizations; each
                    organization keeps its own people and access grants.
                  </p>
                ) : connectedClients.length > 1 ? (
                  <p>
                    {connectedClients.length} app clients have active credentials for this product
                    ID. Keep each client secret in the corresponding app backend.
                  </p>
                ) : (
                  <p>
                    Create an app client in Perminister, then store its client ID and secret in the
                    app backend&apos;s environment. Use the same product ID in every organization.{" "}
                    <Link
                      className="text-link"
                      href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/clients`}
                    >
                      Manage app clients
                    </Link>
                  </p>
                )}
                <p className="product-onboarding-status-note">
                  This status checks active Perminister credentials. Sign in through the application
                  to verify its backend integration.
                </p>
                <Link className="text-link" href="/developers/getting-started">
                  Read the app integration guide
                </Link>
              </div>
            </li>
            <li>
              <span className="onboarding-step">02</span>
              <div>
                <div className="product-onboarding-step-heading">
                  <h3>Add people</h3>
                  <Link
                    className="text-link"
                    href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`}
                  >
                    Manage people
                  </Link>
                </div>
                <p>Invite the people who need accounts in this application.</p>
              </div>
            </li>
            <li>
              <span className="onboarding-step">03</span>
              <div>
                <div className="product-onboarding-step-heading">
                  <h3>Manage access</h3>
                  <Link
                    className="text-link"
                    href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`}
                  >
                    Manage roles
                  </Link>
                  <Link
                    className="text-link"
                    href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
                  >
                    Grant access
                  </Link>
                </div>
                <p>
                  Create reusable permission sets in Access roles, then assign them to people in
                  Access and choose which resources each grant covers.
                </p>
              </div>
            </li>
          </ol>
        </section>
      ) : null}
      <section className="dashboard-card product-detail-card">
        <div className="product-detail-top">
          <ProductIcon name={product.name} src={product.iconUrl} />
          <div>
            <span className="eyebrow">Product ID</span>
            <code className="product-id-code">{product.productId}</code>
            <a className="text-link" href={product.websiteUrl} target="_blank" rel="noreferrer">
              Open website ↗
            </a>
          </div>
        </div>
        {canManageDetails ? (
          <form action={updateOrganizationProductAction} className="auth-form product-edit-form">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="productRecordId" value={product.productRecordId} />
            <h2>Product details</h2>
            <label>
              Name
              <input name="name" defaultValue={product.name} required maxLength={120} />
            </label>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={product.description}
                maxLength={500}
                rows={3}
              />
            </label>
            <label>
              Website
              <input
                name="websiteUrl"
                type="url"
                defaultValue={product.websiteUrl}
                required
                maxLength={2048}
              />
            </label>
            <label>
              Icon URL
              <input name="iconUrl" type="url" defaultValue={product.iconUrl} maxLength={2048} />
            </label>
            <p className="form-hint">
              The product ID is fixed after creation so existing integrations keep working.
            </p>
            <button className="button button-primary" type="submit">
              Save product details
            </button>
          </form>
        ) : (
          <dl className="product-detail-list">
            <dt>Website</dt>
            <dd>
              <a href={product.websiteUrl} target="_blank" rel="noreferrer">
                {product.websiteUrl}
              </a>
            </dd>
            <dt>Created</dt>
            <dd>{new Date(product.createdAt).toLocaleDateString()}</dd>
          </dl>
        )}
      </section>
    </>
  );
}
