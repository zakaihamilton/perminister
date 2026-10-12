import Link from "next/link";
import type { ConsumerClientSummary } from "@/lib/auth/service";

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
