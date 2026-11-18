"use client";

import { useState } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";
import type { GrantScopeKind } from "@/components/access-grant-scope-fields";
import type { ProductAccessRole } from "@/lib/auth/access-roles";

const CUSTOM_ACTIONS = "__custom_actions__";

export function AccessGrantActionsFields({
  roles,
  scopeKind,
}: {
  roles: readonly ProductAccessRole[];
  scopeKind: GrantScopeKind | "";
}) {
  const [choice, setChoice] = useState("");
  const availableRoles = roles.filter(
    (role) =>
      !role.deprecated && (!scopeKind || !role.scopeKinds || role.scopeKinds.includes(scopeKind)),
  );
  const selectedRole = availableRoles.find((role) => role.id === choice);
  const customSelected = choice === CUSTOM_ACTIONS;

  if (availableRoles.length === 0) {
    return (
      <div className="access-actions-field">
        <label htmlFor="grant-actions">Custom app permissions</label>
        <input
          id="grant-actions"
          name="actions"
          required
          maxLength={2048}
          placeholder="Enter product-defined action names"
          aria-describedby="grant-actions-help"
        />
        <small className="access-form-field-help" id="grant-actions-help">
          {roles.some((role) => !role.deprecated)
            ? "No published permission sets support this scope. Choose a different scope or enter the product's action names."
            : "Enter the exact action names checked by this app, separated by commas. Ask the app developer if you are unsure which names it uses."}
        </small>
      </div>
    );
  }

  return (
    <div className="access-actions-field">
      <label htmlFor="grant-access-role">Permission set</label>
      <CustomDropdown
        aria-label="Permission set"
        aria-describedby={customSelected ? undefined : "grant-access-role-help"}
        id="grant-access-role"
        name="accessRoleChoice"
        required
        defaultValue=""
        placeholder="Choose a permission set"
        options={[
          ...availableRoles.map((role) => ({
            value: role.id,
            label: `${role.name}${role.scopeKinds ? ` · ${role.scopeKinds.join(", ")}` : ""}`,
          })),
          { value: CUSTOM_ACTIONS, label: "Custom permissions" },
        ]}
        onValueChange={setChoice}
      />
      {selectedRole ? (
        <>
          <input type="hidden" name="accessRoleId" value={selectedRole.id} />
          <small className="access-form-field-help" id="grant-access-role-help">
            {selectedRole.description || "This permission set was created for this product."}
          </small>
          <small className="access-form-field-help">
            Includes {selectedRole.actions.length} app permission
            {selectedRole.actions.length === 1 ? "" : "s"}.
          </small>
          <div
            aria-label="Included app permission action names"
            className="access-role-actions"
            role="group"
          >
            {selectedRole.actions.map((action) => (
              <code key={action}>{action}</code>
            ))}
          </div>
        </>
      ) : null}
      {customSelected ? (
        <label className="access-custom-actions" htmlFor="grant-actions">
          Custom app permissions
          <input
            id="grant-actions"
            name="actions"
            required
            maxLength={2048}
            placeholder="Enter product-defined action names"
            aria-describedby="grant-actions-help"
          />
          <small className="access-form-field-help" id="grant-actions-help">
            Enter the exact action names checked by this app, separated by commas. Ask the app
            developer if you are unsure which names it uses.
          </small>
        </label>
      ) : null}
      {!selectedRole && !customSelected ? (
        <small className="access-form-field-help" id="grant-access-role-help">
          Choose the permission set that matches what this person needs to do.
        </small>
      ) : null}
    </div>
  );
}
