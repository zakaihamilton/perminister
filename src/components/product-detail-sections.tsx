import Link from "next/link";
import { updateOrganizationProductAction } from "@/app/actions";
import { DashboardNotice } from "@/components/dashboard-shell";
import { ProductIcon } from "@/components/product-icon";
import { ProductVisibilityControl } from "@/components/product-visibility-control";
import type { ProductRecord } from "@/lib/auth/domain";
import type { ConsumerClientSummary, ProductShareInfo } from "@/lib/auth/service";

export function ProductPageNotices({
  error,
  isSharedInstallation,
  notice,
}: {
  error?: string;
  isSharedInstallation: boolean;
  notice?: string;
}) {
  return (
    <>
      {notice === "product-created" ? (
        <DashboardNotice
          message="Product created. Next, connect the app, invite people, and assign access."
          kind="success"
        />
      ) : null}
      {notice === "product-updated" ? (
        <DashboardNotice message="Product details saved." kind="success" />
      ) : null}
      {notice === "product-added" ? (
        <DashboardNotice
          message="Shared product added. Its members, access grants, and credentials are managed in this organization."
          kind="success"
        />
      ) : null}
      {notice === "product-visibility-updated" ? (
        <DashboardNotice message="Product availability updated." kind="success" />
      ) : null}
      {error === "product-visibility-invalid" ? (
        <DashboardNotice
          message="Choose whether this product should be public or private."
          kind="error"
        />
      ) : null}
      {error === "product-visibility-update" ? (
        <DashboardNotice message="Product availability could not be updated." kind="error" />
      ) : null}
      {isSharedInstallation ? (
        <DashboardNotice message="This is a shared product. The publisher controls its details and access roles; people, grants, and credentials remain specific to this organization." />
      ) : null}
    </>
  );
}

export function ProductOnboardingCard({
  connectedClients,
  isSharedInstallation,
  organizationId,
  productId,
}: {
  connectedClients: readonly Pick<ConsumerClientSummary, "appName">[];
  isSharedInstallation: boolean;
  organizationId: string;
  productId: string;
}) {
  return (
    <section className="dashboard-card product-onboarding-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Set up your application</h2>
          <p>
            Perminister handles sign-in and organization membership. Your app keeps its own data and
            checks each person&apos;s access grants before allowing access to protected resources.
          </p>
        </div>
      </div>
      <ol className="product-onboarding-steps">
        <ProductConnectionStep
          connectedClients={connectedClients}
          organizationId={organizationId}
          productId={productId}
        />
        <ProductPeopleStep organizationId={organizationId} productId={productId} />
        <ProductAccessStep
          isSharedInstallation={isSharedInstallation}
          organizationId={organizationId}
          productId={productId}
        />
      </ol>
    </section>
  );
}

function ProductConnectionStep({
  connectedClients,
  organizationId,
  productId,
}: {
  connectedClients: readonly Pick<ConsumerClientSummary, "appName">[];
  organizationId: string;
  productId: string;
}) {
  return (
    <li>
      <span className="onboarding-step">01</span>
      <div>
        <div className="product-onboarding-step-heading">
          <h3>Connect the app</h3>
          <span className={`record-badge ${connectedClients.length ? "active" : "pending"}`}>
            {connectedClients.length ? "Credentials set" : "Next step"}
          </span>
        </div>
        {connectedClients.length === 1 ? (
          <p>
            {connectedClients[0].appName} has active credentials for product ID{" "}
            <code>{productId}</code>. Keep the client secret in the app backend&apos;s environment.
            Reuse this client across organizations; each organization keeps its own people and
            access grants.
          </p>
        ) : connectedClients.length > 1 ? (
          <p>
            {connectedClients.length} app clients have active credentials for this product ID. Keep
            each client secret in the corresponding app backend.
          </p>
        ) : (
          <p>
            Create an app client in Perminister, then store its client ID and secret in the app
            backend&apos;s environment. Use the same product ID in every organization.{" "}
            <Link
              className="text-link"
              href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/clients`}
            >
              Manage app clients
            </Link>
          </p>
        )}
        <p className="product-onboarding-status-note">
          This status checks active Perminister credentials. Sign in through the application to
          verify its backend integration.
        </p>
        <Link className="text-link" href="/developers/getting-started">
          Read the app integration guide
        </Link>
      </div>
    </li>
  );
}

function ProductPeopleStep({
  organizationId,
  productId,
}: {
  organizationId: string;
  productId: string;
}) {
  return (
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
  );
}

function ProductAccessStep({
  isSharedInstallation,
  organizationId,
  productId,
}: {
  isSharedInstallation: boolean;
  organizationId: string;
  productId: string;
}) {
  return (
    <li>
      <span className="onboarding-step">03</span>
      <div>
        <div className="product-onboarding-step-heading">
          <h3>Manage access</h3>
          {isSharedInstallation ? null : (
            <Link
              className="text-link"
              href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`}
            >
              Manage roles
            </Link>
          )}
          <Link
            className="text-link"
            href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
          >
            Grant access
          </Link>
        </div>
        <p>
          Create reusable permission sets in Access roles, then assign them to people in Access and
          choose which resources each grant covers.
        </p>
      </div>
    </li>
  );
}

export function ProductDetailsCard({
  canManageDetails,
  initialDialogOpen,
  organizationId,
  product,
  shareInfo,
}: {
  canManageDetails: boolean;
  initialDialogOpen: boolean;
  organizationId: string;
  product: ProductRecord;
  shareInfo: ProductShareInfo | null;
}) {
  return (
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
      {canManageDetails && shareInfo ? (
        <ProductVisibilityControl
          organizationId={organizationId}
          productId={product.productId}
          productRecordId={product.productRecordId}
          visibility={shareInfo.visibility}
          adopterOrganizations={shareInfo.adopterOrganizations}
          initialDialogOpen={initialDialogOpen}
        />
      ) : null}
    </section>
  );
}
