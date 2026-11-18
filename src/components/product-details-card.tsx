import { ProductIcon } from "@/components/product-icon";
import { ProductLifecycleControl } from "@/components/product-lifecycle-control";
import { ProductMoveControl } from "@/components/product-move-control";
import { ProductTransferControl } from "@/components/product-transfer-control";
import { ProductVisibilityControl } from "@/components/product-visibility-control";
import type { ProductRecord } from "@/lib/auth/domain";
import type {
  OrganizationProductMoveOptions,
  OrganizationProductTransferOptions,
  ProductShareInfo,
} from "@/lib/auth/service";

export function ProductDetailsCard({
  canManageDetails,
  canManageLifecycle,
  adopterOrganizations,
  initialDialogOpen,
  organizationId,
  product,
  shareInfo,
  canTransferPublisher,
  transferOptions,
  canMoveProduct,
  moveOptions,
}: {
  canManageDetails: boolean;
  canManageLifecycle: boolean;
  adopterOrganizations: Array<{ organizationId: string; name: string }>;
  initialDialogOpen: boolean;
  organizationId: string;
  product: ProductRecord;
  shareInfo: ProductShareInfo | null;
  canTransferPublisher: boolean;
  transferOptions: OrganizationProductTransferOptions;
  canMoveProduct: boolean;
  moveOptions: OrganizationProductMoveOptions;
}) {
  const showTransferControl =
    canTransferPublisher &&
    !product.pendingMove &&
    !product.sharedProductRef &&
    transferOptions.destinations.length > 0;
  const showMoveControl =
    canMoveProduct &&
    !product.sharedProductRef &&
    (product.visibility !== "public" || !!product.pendingMove);

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
      {canManageDetails && !product.pendingMove ? (
        <form
          action="/actions/updateOrganizationProductAction"
          method="post"
          className="auth-form product-edit-form"
        >
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
      {canManageDetails && !product.pendingMove && !product.sharedProductRef && shareInfo ? (
        <ProductVisibilityControl
          organizationId={organizationId}
          productId={product.productId}
          productRecordId={product.productRecordId}
          visibility={shareInfo.visibility}
          adopterOrganizations={shareInfo.adopterOrganizations}
          initialDialogOpen={initialDialogOpen}
        />
      ) : null}
      {showMoveControl ? (
        <section
          className="product-visibility-control product-move-control"
          aria-labelledby="product-move-title"
        >
          <div>
            <h2 id="product-move-title">Move product</h2>
            <p>
              Move this private product and its product-specific members, permissions, invitations,
              clients, integrations, and API keys to another organization you own. It stays private.
            </p>
          </div>
          <ProductMoveControl
            destinations={moveOptions.destinations}
            pendingDestinationOrganizationId={moveOptions.pendingDestinationOrganizationId}
            productId={product.productId}
            productName={product.name}
            productRecordId={product.productRecordId}
            sourceOrganizationId={moveOptions.sourceOrganizationId}
          />
        </section>
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
      {canManageLifecycle && !product.pendingMove ? (
        <ProductLifecycleControl
          adopterOrganizations={adopterOrganizations}
          organizationId={organizationId}
          product={product}
        />
      ) : null}
    </section>
  );
}
