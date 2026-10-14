"use client";

import { useState } from "react";
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
  const defaultScopeKind = defaults?.scope.kind ?? "product";
  const defaultResourceId =
    defaults?.scope.kind === "project"
      ? defaults.scope.projectId
      : defaults?.scope.kind === "workspace"
        ? defaults.scope.workspaceId
        : "";
  const [scopeKind, setScopeKind] = useState(defaultScopeKind);
  const [resourceId, setResourceId] = useState(defaultResourceId);

  return (
    <div className="form-grid">
      <div className="form-field-with-tooltip">
        <div className="form-label-row">
          <label htmlFor={`${formId}-scope`}>Where can this key be used?</label>
          <Tooltip
            content="Choose whether this key works across a product or only in one project or workspace."
            label="More information about key scope"
          />
        </div>
        <CustomDropdown
          aria-label="Where can this key be used?"
          id={`${formId}-scope`}
          name="scopeKind"
          defaultValue={scopeKind}
          options={[
            { value: "product", label: "Product" },
            { value: "project", label: "Project" },
            { value: "workspace", label: "Workspace" },
          ]}
          onValueChange={(value) => {
            if (value === "product" || value === "project" || value === "workspace") {
              setScopeKind(value);
            }
          }}
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
      {scopeKind !== "product" ? (
        <div className="form-field-with-tooltip">
          <div className="form-label-row">
            <label htmlFor={`${formId}-resource-id`}>
              {scopeKind === "project" ? "Project ID" : "Workspace ID"}
            </label>
            <Tooltip
              content={`Enter the ${scopeKind} ID used by your product.`}
              label={`More information about the ${scopeKind} ID`}
            />
          </div>
          <input
            id={`${formId}-resource-id`}
            name="resourceId"
            required
            maxLength={128}
            pattern="[a-z0-9][a-z0-9._:-]*"
            value={resourceId}
            autoCapitalize="none"
            onChange={(event) => setResourceId(event.currentTarget.value.toLowerCase())}
          />
        </div>
      ) : null}
      <div className="form-field-with-tooltip">
        <div className="form-label-row">
          <label htmlFor={`${formId}-actions`}>Actions this key can perform</label>
          <Tooltip
            content="Enter the action names your product checks, separated by commas."
            label="More information about allowed actions"
          />
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
          <Tooltip
            content="An expired key cannot authorize requests. A key with no expiration stays active until it is revoked."
            label="More information about key expiration"
          />
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
