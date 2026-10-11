import { CustomDropdown } from "@/components/custom-dropdown";
import { Tooltip } from "@/components/tooltip";
import type { ProductRecord, ResourceScope } from "@/lib/auth/domain";

export interface ApiKeyFormDefaults {
  scope: ResourceScope;
  actions: readonly string[];
  expiresInDays: string;
}

export function ApiKeyFormFields({
  defaults,
  formId,
  products,
}: {
  defaults?: ApiKeyFormDefaults;
  formId: string;
  products: ProductRecord[];
}) {
  const scopeKind = defaults?.scope.kind ?? "product";
  const resourceId =
    defaults?.scope.kind === "project"
      ? defaults.scope.projectId
      : defaults?.scope.kind === "workspace"
        ? defaults.scope.workspaceId
        : "";

  return (
    <div className="form-grid">
      <div className="form-field-with-tooltip">
        <div className="form-label-row">
          <label htmlFor={`${formId}-scope`}>Scope type</label>
          <Tooltip content="Choose whether this key can act across a product, or only within one project or workspace." />
        </div>
        <CustomDropdown
          aria-label="Scope type"
          id={`${formId}-scope`}
          name="scopeKind"
          defaultValue={scopeKind}
          options={[
            { value: "product", label: "Product" },
            { value: "project", label: "Project" },
            { value: "workspace", label: "Workspace" },
          ]}
        />
      </div>
      <label htmlFor={`${formId}-product`}>
        Product
        <CustomDropdown
          aria-label="Product"
          id={`${formId}-product`}
          name="productId"
          required
          defaultValue={defaults?.scope.productId ?? products[0]?.productId ?? ""}
          placeholder="Select a product"
          options={products.map((product) => ({
            value: product.productId,
            label: product.name,
          }))}
        />
      </label>
      <div className="form-field-with-tooltip">
        <div className="form-label-row">
          <label htmlFor={`${formId}-resource-id`}>Project or workspace ID</label>
          <Tooltip content="Enter the resource ID used by your product. Leave this blank for product-wide access." />
        </div>
        <input
          id={`${formId}-resource-id`}
          name="resourceId"
          maxLength={128}
          defaultValue={resourceId}
          autoCapitalize="none"
          onChange={(event) => {
            event.currentTarget.value = event.currentTarget.value.toLowerCase();
          }}
        />
      </div>
      <div className="form-field-with-tooltip">
        <div className="form-label-row">
          <label htmlFor={`${formId}-actions`}>Allowed actions</label>
          <Tooltip content="Use the action names your product checks during authorization, separated by commas." />
        </div>
        <input
          id={`${formId}-actions`}
          name="actions"
          required
          maxLength={2048}
          defaultValue={defaults?.actions.join(", ") ?? ""}
          placeholder="read:profile, write:profile"
        />
      </div>
      <div className="form-field-with-tooltip">
        <div className="form-label-row">
          <label htmlFor={`${formId}-expiration`}>Expiration</label>
          <Tooltip content="An expired key cannot authorize requests. A key with no expiration stays active until it is revoked." />
        </div>
        <CustomDropdown
          aria-label="Expiration"
          id={`${formId}-expiration`}
          name="expiresInDays"
          defaultValue={defaults?.expiresInDays ?? "30"}
          options={[
            { value: "1", label: "1 day" },
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "never", label: "No expiration" },
          ]}
        />
      </div>
    </div>
  );
}
