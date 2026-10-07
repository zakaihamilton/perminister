import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { updateOrganizationProductAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ProductIcon } from "@/components/product-icon";
import { getCurrentSession, getProductAccessForSubject } from "@/lib/auth/service";
import { getConsumerClientsForProduct } from "@/lib/auth/consumer-clients";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; productId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId, productId }, query] = await Promise.all([params, searchParams]);
  const productAccess = await getProductAccessForSubject(
    current.subject.subjectId,
    organizationId,
    productId,
  ).catch(() => null);
  if (!productAccess) notFound();
  const product = productAccess.product;
  const canManageDetails = productAccess.catalogManager;
  const productRole = productAccess.membership?.role;
  const connectedClients = getConsumerClientsForProduct(product.productId);
  const canManageProduct = productRole === "owner" || productRole === "admin";
  return (
    <>
      <DashboardHeading
        eyebrow="Products"
        title={product.name}
        description={product.description || "Product details and stable integration ID."}
        action={
          productRole === "owner" || productRole === "admin" ? (
            <div className="product-detail-actions">
              <Link
                className="button button-secondary"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`}
              >
                People
              </Link>
              <Link
                className="button button-secondary"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
              >
                Access
              </Link>
              <Link
                className="button button-secondary"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/api-keys`}
              >
                API keys
              </Link>
              <Link
                className="button button-secondary"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/activity`}
              >
                Activity
              </Link>
            </div>
          ) : productRole === "member" ? (
            <div className="product-detail-actions">
              <Link
                className="button button-secondary"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
              >
                My access
              </Link>
              <Link
                className="button button-secondary"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/api-keys`}
              >
                API keys
              </Link>
              <Link
                className="button button-secondary"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/activity`}
              >
                Activity
              </Link>
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
                and checks the access it needs.
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
                    {connectedClients[0].appName} has Perminister client credentials bound to
                    product ID <code>{product.productId}</code>. Keep the client secret in the app
                    server&apos;s environment. Reuse this app setup across organizations; each
                    organization keeps its own people and access grants.
                  </p>
                ) : connectedClients.length > 1 ? (
                  <p>
                    {connectedClients.length} app clients have credentials for this product ID. Use
                    one shared app client to keep setup simple.
                  </p>
                ) : (
                  <p>
                    Connect the app&apos;s backend to Perminister, then set its client ID and secret
                    in this deployment. Bind that client with{" "}
                    <code>PERMINISTER_APP_CLIENT_IDS</code>,
                    <code> PERMINISTER_APP_CLIENT_{"{ID}"}_SECRET</code>, and{" "}
                    <code>PERMINISTER_APP_CLIENT_{"{ID}"}_PRODUCT_ID</code> set to{" "}
                    <code>{product.productId}</code>. Use that same product ID in each organization.
                  </p>
                )}
                <p className="product-onboarding-status-note">
                  This status only checks Perminister&apos;s client configuration. Sign in through
                  the application to verify that its backend integration works.
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
                  <h3>Assign access</h3>
                  <Link
                    className="text-link"
                    href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
                  >
                    Manage access
                  </Link>
                </div>
                <p>
                  Create reusable roles for this organization&apos;s product, then choose one and
                  set the resources it covers when granting access.
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
