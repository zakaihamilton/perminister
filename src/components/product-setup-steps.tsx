import { createOrganizationProductAction, type ProductLookupState } from "@/app/actions";
import { ProductIcon } from "@/components/product-icon";

export function ProductWebsiteLookupStep({
  lookupAction,
  lookupState,
  onStartManualEntry,
  onSourceChange,
  pending,
  showDetails,
  source,
  organizationId,
}: {
  lookupAction: (payload: FormData) => void;
  lookupState: ProductLookupState;
  onStartManualEntry: () => void;
  onSourceChange: (value: string) => void;
  pending: boolean;
  showDetails: boolean;
  source: string;
  organizationId: string;
}) {
  return (
    <section className="product-setup-step">
      <span className="onboarding-step">01</span>
      <div className="product-setup-step-body">
        <h2>Start with a website</h2>
        <p>Enter a website address to suggest product details, or enter the details manually.</p>
        <form action={lookupAction} className="product-source-form">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label>
            Website address
            <input
              name="source"
              type="url"
              value={source}
              onChange={(event) => onSourceChange(event.target.value)}
              placeholder="https://example.com"
              required
              maxLength={2048}
            />
          </label>
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? "Looking up…" : "Fetch website details"}
          </button>
        </form>
        {lookupState.error ? (
          <p className="form-error" role="alert">
            {lookupState.error}
          </p>
        ) : null}
        {!showDetails ? (
          <button
            className="text-link product-manual-button"
            type="button"
            onClick={onStartManualEntry}
          >
            Enter product details manually
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function ProductDetailsReviewStep({
  description,
  iconUrl,
  name,
  onDescriptionChange,
  onIconUrlChange,
  onNameChange,
  onProductIdChange,
  onWebsiteUrlChange,
  organizationId,
  productId,
  websiteUrl,
}: {
  description: string;
  iconUrl: string;
  name: string;
  onDescriptionChange: (value: string) => void;
  onIconUrlChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onProductIdChange: (value: string) => void;
  onWebsiteUrlChange: (value: string) => void;
  organizationId: string;
  productId: string;
  websiteUrl: string;
}) {
  return (
    <section className="product-setup-step product-details-step">
      <span className="onboarding-step">02</span>
      <div className="product-setup-step-body">
        <h2>Review product details</h2>
        <p>Your product ID stays stable after creation and is scoped to this organization.</p>
        {iconUrl ? (
          <ProductIcon name={name} src={iconUrl} className="product-icon-preview" size={45} />
        ) : null}
        <form action={createOrganizationProductAction} className="auth-form product-details-form">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label>
            Product name
            <input
              name="name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            Product ID
            <input
              name="productId"
              value={productId}
              autoCapitalize="none"
              onChange={(event) => onProductIdChange(event.target.value)}
              required
              maxLength={128}
              pattern="[a-z0-9][a-z0-9._:-]*"
            />
            <span className="form-hint">
              Generated from the name and kept lowercase. Edit it here if your integration already
              uses a different ID.
            </span>
          </label>
          <label>
            Website
            <input
              name="websiteUrl"
              type="url"
              value={websiteUrl}
              onChange={(event) => onWebsiteUrlChange(event.target.value)}
              required
              maxLength={2048}
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
          <label>
            Icon URL <span className="form-hint">Optional</span>
            <input
              name="iconUrl"
              type="url"
              value={iconUrl}
              onChange={(event) => onIconUrlChange(event.target.value)}
              maxLength={2048}
            />
          </label>
          <button
            className="button button-primary"
            type="submit"
            disabled={!name.trim() || !productId.trim() || !websiteUrl.trim()}
          >
            Create product
          </button>
        </form>
      </div>
    </section>
  );
}
