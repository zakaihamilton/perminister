import { updateOrganizationProductAction } from "@/app/actions";
import { ProductIcon } from "@/components/product-icon";
import { ProductTransferControl } from "@/components/product-transfer-control";
import { ProductVisibilityControl } from "@/components/product-visibility-control";
import type { ProductRecord } from "@/lib/auth/domain";
import type { OrganizationProductTransferOptions, ProductShareInfo } from "@/lib/auth/service";

export function ProductDetailsCard({
  canManageDetails,
  initialDialogOpen,
  organizationId,
  product,
  shareInfo,
  canTransferPublisher,
  transferOptions,
}: {
  canManageDetails: boolean;
  initialDialogOpen: boolean;
  organizationId: string;
  product: ProductRecord;
  shareInfo: ProductShareInfo | null;
  canTransferPublisher: boolean;
  transferOptions: OrganizationProductTransferOptions;
}) {
  const showTransferControl =
    canTransferPublisher && !product.sharedProductRef && transferOptions.destinations.length > 0;

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
      {canManageDetails && !product.sharedProductRef && shareInfo ? (
        <ProductVisibilityControl
          organizationId={organizationId}
          productId={product.productId}
          productRecordId={product.productRecordId}
          visibility={shareInfo.visibility}
          adopterOrganizations={shareInfo.adopterOrganizations}
          initialDialogOpen={initialDialogOpen}
        />
      ) : null}
      {showTransferControl ? (
        <section
          className="product-visibility-control product-publisher-transfer-control"
          aria-labelledby="product-publisher-transfer-title"
        >
          <div>
            <h2 id="product-publisher-transfer-title">Transfer publisher</h2>
            <p>
              Transfer this product’s publisher role to another approved organization you own.
              Organizations already using this published product keep their setup and access.
            </p>
          </div>
          <ProductTransferControl
            destinations={transferOptions.destinations}
            pendingDestinationOrganizationId={transferOptions.pendingDestinationOrganizationId}
            productId={product.productId}
            productName={product.name}
            productRecordId={product.productRecordId}
            sourceOrganizationId={organizationId}
          />
        </section>
      ) : null}
    </section>
  );
}
