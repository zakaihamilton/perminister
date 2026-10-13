import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ConsumerClientManager } from "@/components/consumer-client-manager";
import { ProductNavigation } from "@/components/product-navigation";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import { listConsumerClientsForProduct } from "@/lib/auth/service";

export default async function ProductClientsPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ current, organizationId, productId, access }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  requireProductManagerRole(access.membership?.role, organizationId, productId);
  const isSharedInstallation = Boolean(access.product.sharedProductRef);

  const clients = await listConsumerClientsForProduct(
    current.subject.subjectId,
    organizationId,
    productId,
  );
  const returnTo = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/clients`;

  return (
    <>
      <DashboardHeading
        description={
          isSharedInstallation
            ? `${access.product.name} uses the publisher’s app client configuration across every organization using this public product.`
            : `Connect ${access.product.name} to Perminister with app client credentials.`
        }
      />
      <ProductNavigation
        isSharedInstallation={isSharedInstallation}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        role={access.membership?.role}
      />
      {query.notice === "client-revoked" ? (
        <DashboardNotice
          message="App client revoked. Its credentials will no longer work."
          kind="success"
        />
      ) : query.error ? (
        <DashboardNotice message={query.error} kind="error" />
      ) : null}
      <ConsumerClientManager
        clients={clients}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        returnTo={returnTo}
        readOnly={isSharedInstallation}
      />
    </>
  );
}
