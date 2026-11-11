import { skeletonClasses } from "@/components/skeleton-classnames";
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
  const isArchived = Boolean(product.archivedAt);
  const canManageLifecycle =
    productAccess.catalogManager &&
    (productAccess.catalogRole === "owner" || productAccess.catalogRole === "admin");
  const canManageDetails = canManageLifecycle && !isSharedInstallation && !isArchived;
  const canTransferPublisher =
    canManageLifecycle &&
    productAccess.catalogRole === "owner" &&
    !isSharedInstallation &&
    !isArchived;
  const productRole = productAccess.membership?.role;
  const canManageProduct = !isArchived && (productRole === "owner" || productRole === "admin");

  return (
    <>
      <DashboardHeading
        description={
          product.description || "Manage this product, its members, and their permissions."
        }
      />
      {isArchived ? null : (
        <ProductPageNavigation
          access={productAccess}
          organizationId={organizationId}
          productId={productId}
        />
      )}
      <ProductPageNotices
        error={query.error}
        isArchived={isArchived}
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
          canManageLifecycle={canManageLifecycle}
          canTransferPublisher={canTransferPublisher}
          initialDialogOpen={query.error === "product-private-confirmation"}
          organizationId={organizationId}
          product={product}
          adopterOrganizations={[]}
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
  canManageLifecycle,
  canTransferPublisher,
  initialDialogOpen,
  organizationId,
  product,
  adopterOrganizations,
  subjectId,
}: {
  canManageDetails: boolean;
  canManageLifecycle: boolean;
  canTransferPublisher: boolean;
  initialDialogOpen: boolean;
  organizationId: string;
  product: ProductRecord;
  adopterOrganizations: Array<{ organizationId: string; name: string }>;
  subjectId: SubjectId;
}) {
  const [shareInfo, transferOptions] = await Promise.all([
    canManageLifecycle && !product.sharedProductRef
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
      canManageLifecycle={canManageLifecycle}
      adopterOrganizations={shareInfo?.adopterOrganizations ?? adopterOrganizations}
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
      className={skeletonClasses("dashboard-skeleton-grid", "is-one-column")}
      role="status"
    >
      <span className="visually-hidden">{label}</span>
      <div aria-hidden="true" className={skeletonClasses("dashboard-skeleton-card")}>
        <span className={skeletonClasses("dashboard-skeleton-block", "is-card-title")} />
        <span className={skeletonClasses("dashboard-skeleton-block", "is-card-description")} />
        <div className={skeletonClasses("dashboard-skeleton-rows")}>
          {[0, 1, 2].map((row) => (
            <div className={skeletonClasses("dashboard-skeleton-row")} key={row}>
              <span className={skeletonClasses("dashboard-skeleton-block", "is-avatar")} />
              <div className={skeletonClasses("dashboard-skeleton-row-copy")}>
                <span className={skeletonClasses("dashboard-skeleton-block", "is-row-title")} />
                <span className={skeletonClasses("dashboard-skeleton-block", "is-row-detail")} />
              </div>
              <span className={skeletonClasses("dashboard-skeleton-block", "is-row-action")} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
