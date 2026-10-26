import { Suspense } from "react";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  ProductDetailsCard,
  ProductOnboardingCard,
  ProductPageNotices,
} from "@/components/product-detail-sections";
import { ProductPageNavigation } from "@/components/product-navigation";
import type { ProductRecord, SubjectId } from "@/lib/auth/domain";
import {
  getProductPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import {
  getOwnedPublicProductTransferOptions,
  getProductShareInfo,
  listConsumerClientsForProduct,
} from "@/lib/auth/service";
import { withRequestPerformance } from "@/lib/auth/performance";

export default async function ProductPage({ params, searchParams }: ProductPageWithSearchParams) {
  const [context, query] = await Promise.all([
    withRequestPerformance("dashboard.product-page-context", () => getProductPageContext(params)),
    searchParams,
  ]);
  const { current, organizationId, productId, access: productAccess } = context;
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

  return (
    <>
      <DashboardHeading
        description={
          product.description || "Manage this product, its members, and their permissions."
        }
      />
      <ProductPageNavigation
        access={productAccess}
        organizationId={organizationId}
        productId={productId}
      />
      <ProductPageNotices
        error={query.error}
        isSharedInstallation={isSharedInstallation}
        notice={query.notice}
        reason={query.reason}
      />
      {canManageProduct ? (
        <Suspense fallback={<ProductPanelSkeleton label="Loading setup details" />}>
          <ProductOnboardingPanel
            isPublicPublisher={!isSharedInstallation && product.visibility === "public"}
            isSharedInstallation={isSharedInstallation}
            organizationId={organizationId}
            productId={productId}
            subjectId={current.subject.subjectId}
          />
        </Suspense>
      ) : null}
      <Suspense fallback={<ProductPanelSkeleton label="Loading product details" />}>
        <ProductDetailsPanel
          canManageDetails={canManageDetails}
          canTransferPublisher={canTransferPublisher}
          initialDialogOpen={query.error === "product-private-confirmation"}
          organizationId={organizationId}
          product={product}
          subjectId={current.subject.subjectId}
        />
      </Suspense>
    </>
  );
}

async function ProductOnboardingPanel({
  isPublicPublisher,
  isSharedInstallation,
  organizationId,
  productId,
  subjectId,
}: {
  isPublicPublisher: boolean;
  isSharedInstallation: boolean;
  organizationId: string;
  productId: string;
  subjectId: SubjectId;
}) {
  const productClients = await withRequestPerformance("dashboard.product-onboarding", () =>
    listConsumerClientsForProduct(subjectId, organizationId, productId),
  );
  return (
    <ProductOnboardingCard
      connectedClients={productClients.filter((client) => client.status === "active")}
      isSharedInstallation={isSharedInstallation}
      isPublicPublisher={isPublicPublisher}
      organizationId={organizationId}
      productId={productId}
    />
  );
}

async function ProductDetailsPanel({
  canManageDetails,
  canTransferPublisher,
  initialDialogOpen,
  organizationId,
  product,
  subjectId,
}: {
  canManageDetails: boolean;
  canTransferPublisher: boolean;
  initialDialogOpen: boolean;
  organizationId: string;
  product: ProductRecord;
  subjectId: SubjectId;
}) {
  const [shareInfo, transferOptions] = await Promise.all([
    canManageDetails
      ? withRequestPerformance("dashboard.product-share-info", () =>
          getProductShareInfo(subjectId, organizationId, product.productRecordId),
        )
      : Promise.resolve(null),
    canTransferPublisher
      ? withRequestPerformance("dashboard.product-transfer-options", () =>
          getOwnedPublicProductTransferOptions(subjectId, organizationId, product.productRecordId),
        )
      : Promise.resolve({ destinations: [] }),
  ]);
  return (
    <ProductDetailsCard
      canManageDetails={canManageDetails}
      initialDialogOpen={initialDialogOpen}
      organizationId={organizationId}
      product={product}
      shareInfo={shareInfo}
      canTransferPublisher={canTransferPublisher}
      transferOptions={transferOptions}
    />
  );
}

function ProductPanelSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="dashboard-skeleton-grid is-one-column"
      role="status"
    >
      <span className="visually-hidden">{label}</span>
      <div aria-hidden="true" className="dashboard-skeleton-card">
        <span className="dashboard-skeleton-block is-card-title" />
        <span className="dashboard-skeleton-block is-card-description" />
        <div className="dashboard-skeleton-rows">
          {[0, 1, 2].map((row) => (
            <div className="dashboard-skeleton-row" key={row}>
              <span className="dashboard-skeleton-block is-avatar" />
              <div className="dashboard-skeleton-row-copy">
                <span className="dashboard-skeleton-block is-row-title" />
                <span className="dashboard-skeleton-block is-row-detail" />
              </div>
              <span className="dashboard-skeleton-block is-row-action" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
