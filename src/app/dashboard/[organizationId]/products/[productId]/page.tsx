import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  ProductDetailsCard,
  ProductOnboardingCard,
  ProductPageNotices,
} from "@/components/product-detail-sections";
import {
  getProductPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import { getProductShareInfo, listConsumerClientsForProduct } from "@/lib/auth/service";

export default async function ProductPage({ params, searchParams }: ProductPageWithSearchParams) {
  const [{ current, organizationId, productId, access: productAccess }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  const product = productAccess.product;
  const isSharedInstallation = Boolean(product.sharedProductRef);
  const canManageDetails =
    productAccess.catalogManager &&
    (productAccess.catalogRole === "owner" || productAccess.catalogRole === "admin") &&
    !isSharedInstallation;
  const productRole = productAccess.membership?.role;
  const canManageProduct = productRole === "owner" || productRole === "admin";
  const [productClients, shareInfo] = await Promise.all([
    canManageProduct
      ? listConsumerClientsForProduct(current.subject.subjectId, organizationId, product.productId)
      : Promise.resolve([]),
    canManageDetails
      ? getProductShareInfo(current.subject.subjectId, organizationId, product.productRecordId)
      : Promise.resolve(null),
  ]);
  const connectedClients = productClients.filter((client) => client.status === "active");
  const productActionLinks = canManageProduct
    ? [
        { path: "people", label: "People" },
        { path: "access", label: "Access" },
        ...(isSharedInstallation ? [] : [{ path: "roles", label: "Access roles" }]),
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
      <ProductPageNotices
        error={query.error}
        isSharedInstallation={isSharedInstallation}
        notice={query.notice}
      />
      {canManageProduct ? (
        <ProductOnboardingCard
          connectedClients={connectedClients}
          isSharedInstallation={isSharedInstallation}
          organizationId={organizationId}
          productId={productId}
        />
      ) : null}
      <ProductDetailsCard
        canManageDetails={canManageDetails}
        initialDialogOpen={query.error === "product-private-confirmation"}
        organizationId={organizationId}
        product={product}
        shareInfo={shareInfo}
      />
    </>
  );
}
