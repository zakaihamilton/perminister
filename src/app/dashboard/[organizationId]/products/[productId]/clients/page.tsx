import Link from "next/link";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ConsumerClientManager } from "@/components/consumer-client-manager";
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

  const clients = await listConsumerClientsForProduct(
    current.subject.subjectId,
    organizationId,
    productId,
  );
  const returnTo = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/clients`;

  return (
    <>
      <DashboardHeading
        description={`Create and manage the backend credentials that connect ${access.product.name} to Perminister.`}
        action={
          <Link
            className="button button-secondary"
            href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}`}
          >
            Back to product
          </Link>
        }
      />
      {query.notice === "client-revoked" ? (
        <DashboardNotice
          message="App client revoked. Its credentials are no longer accepted."
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
      />
    </>
  );
}
