import { DashboardHeading } from "@/components/dashboard-shell";
import {
  ProductDetailsCard,
  ProductOnboardingCard,
  ProductPageNotices,
} from "@/components/product-detail-sections";
import { ProductNavigation } from "@/components/product-navigation";
import {
  getProductPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import {
  getOwnedPublicProductTransferOptions,
  getProductShareInfo,
  listConsumerClientsForProduct,
} from "@/lib/auth/service";

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
  const canTransferPublisher =
    productAccess.catalogManager && productAccess.catalogRole === "owner" && !isSharedInstallation;
  const productRole = productAccess.membership?.role;
  const canManageProduct = productRole === "owner" || productRole === "admin";
  const [productClients, shareInfo, transferOptions] = await Promise.all([
    canManageProduct
      ? listConsumerClientsForProduct(current.subject.subjectId, organizationId, product.productId)
      : Promise.resolve([]),
    canManageDetails
      ? getProductShareInfo(current.subject.subjectId, organizationId, product.productRecordId)
      : Promise.resolve(null),
    canTransferPublisher
      ? getOwnedPublicProductTransferOptions(
          current.subject.subjectId,
          organizationId,
          product.productRecordId,
        )
      : Promise.resolve({ destinations: [] }),
  ]);
  const connectedClients = productClients.filter((client) => client.status === "active");
  return (
    <>
      <DashboardHeading
        description={
          product.description || "Manage this product, its members, and their permissions."
        }
      />
      <ProductNavigation
        isSharedInstallation={isSharedInstallation}
        organizationId={organizationId}
        productId={productId}
        productName={product.name}
        role={productRole}
      />
      <ProductPageNotices
        error={query.error}
        isSharedInstallation={isSharedInstallation}
        notice={query.notice}
        reason={query.reason}
      />
      {canManageProduct ? (
        <ProductOnboardingCard
          connectedClients={connectedClients}
          isSharedInstallation={isSharedInstallation}
          isPublicPublisher={!isSharedInstallation && product.visibility === "public"}
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
        canTransferPublisher={canTransferPublisher}
        transferOptions={transferOptions}
      />
    </>
  );
}
