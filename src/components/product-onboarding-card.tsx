import Link from "next/link";
import type { ConsumerClientSummary } from "@/lib/auth/service";

export function ProductOnboardingCard({
  connectedClients,
  isSharedInstallation,
  isPublicPublisher,
  organizationId,
  productId,
}: {
  connectedClients: readonly Pick<ConsumerClientSummary, "appName">[];
  isSharedInstallation: boolean;
  isPublicPublisher: boolean;
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
            checks each person&apos;s permissions before allowing access to protected resources.
          </p>
        </div>
      </div>
      <ol className="product-onboarding-steps">
        <ProductConnectionStep
          connectedClients={connectedClients}
          isSharedInstallation={isSharedInstallation}
          isPublicPublisher={isPublicPublisher}
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
  isSharedInstallation,
  isPublicPublisher,
  organizationId,
  productId,
}: {
  connectedClients: readonly Pick<ConsumerClientSummary, "appName">[];
  isSharedInstallation: boolean;
  isPublicPublisher: boolean;
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
        {isSharedInstallation ? (
          <>
            {connectedClients.length ? (
              <p>
                {connectedClients.length === 1
                  ? `${connectedClients[0].appName} is connected for this public product.`
                  : `${connectedClients.length} app clients are configured for this public product.`}{" "}
                App client settings are managed by the publisher and apply to all organizations
                using the product.
              </p>
            ) : (
              <p>
                The publisher has not configured an active app client for this public product yet.
              </p>
            )}
            <Link
              className="text-link"
              href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/clients`}
            >
              View app clients
            </Link>
          </>
        ) : connectedClients.length === 1 ? (
          <p>
            {connectedClients[0].appName} has active credentials for product ID{" "}
            <code>{productId}</code>. Keep the client secret in the app backend&apos;s environment.
            {isPublicPublisher
              ? " Reuse this client across organizations; each organization keeps its own people and permissions."
              : ""}
          </p>
        ) : connectedClients.length > 1 ? (
          <p>
            {connectedClients.length} app clients have active credentials for this product ID. Keep
            each client secret in the corresponding app backend.
          </p>
        ) : (
          <p>
            Create an app client in Perminister, then store its client ID and secret in the app
            backend&apos;s environment.
            {isPublicPublisher
              ? " Use the same product ID in every organization that installs this public product."
              : ""}{" "}
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
          <h3>Permissions</h3>
          {isSharedInstallation ? null : (
            <Link
              className="text-link"
              href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`}
            >
              Manage permission sets
            </Link>
          )}
          <Link
            className="text-link"
            href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}
          >
            Assign permissions
          </Link>
        </div>
        <p>
          Create reusable permission sets, then assign them to product members and choose which
          resources their permissions cover.
        </p>
      </div>
    </li>
  );
}
