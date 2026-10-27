"use client";

import { useState } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";

type GrantScopeKind = "product" | "project" | "workspace";

export function AccessGrantScopeFields() {
  const [scopeKind, setScopeKind] = useState<GrantScopeKind | "">("");

  function handleScopeChange(value: string) {
    if (value === "product" || value === "project" || value === "workspace") {
      setScopeKind(value);
    }
  }

  const scopeDescription =
    scopeKind === "product"
      ? "These actions apply across all resources in this product."
      : scopeKind === "project"
        ? "These actions apply only to the project ID entered below."
        : scopeKind === "workspace"
          ? "These actions apply only to the workspace ID entered below."
          : "Choose where these permissions should apply.";

  const resourceLabel = scopeKind === "project" ? "Project ID" : "Workspace ID";
  const resourcePlaceholder = scopeKind === "project" ? "Enter project ID" : "Enter workspace ID";

  return (
    <>
      <div className="access-scope-field">
        <label htmlFor="grant-scope">Where do permissions apply?</label>
        <CustomDropdown
          aria-label="Where do permissions apply?"
          aria-describedby="grant-scope-help"
          id="grant-scope"
          name="scopeKind"
          placeholder="Choose a scope"
          required
          options={[
            { value: "product", label: "Entire product" },
            { value: "project", label: "One project" },
            { value: "workspace", label: "One workspace" },
          ]}
          onValueChange={handleScopeChange}
        />
        <small className="access-form-field-help" id="grant-scope-help">
          {scopeDescription}
        </small>
      </div>
      {scopeKind === "project" || scopeKind === "workspace" ? (
        <label className="access-resource-field" htmlFor="grant-resource-id" key={scopeKind}>
          {resourceLabel}
          <input
            id="grant-resource-id"
            name="resourceId"
            required
            maxLength={128}
            pattern="[a-z0-9][a-z0-9._:-]*"
            placeholder={resourcePlaceholder}
            autoCapitalize="none"
            onChange={(event) => {
              event.currentTarget.value = event.currentTarget.value.toLowerCase();
            }}
            aria-describedby="grant-resource-id-help"
          />
          <small className="access-form-field-help" id="grant-resource-id-help">
            Enter the ID used by your connected product. Uppercase letters are converted to
            lowercase.
          </small>
        </label>
      ) : null}
    </>
  );
}
