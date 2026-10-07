"use client";

import { useState } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";
import type { ProductAccessRole } from "@/lib/auth/access-roles";

const CUSTOM_ACTIONS = "__custom_actions__";

export function AccessGrantActionsFields({ roles }: { roles: readonly ProductAccessRole[] }) {
  const [choice, setChoice] = useState("");
  const selectedRole = roles.find((role) => role.id === choice);
  const customSelected = choice === CUSTOM_ACTIONS;

  if (roles.length === 0) {
    return (
      <label className="access-actions-field" htmlFor="grant-actions">
        Custom API actions
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
    );
  }

  return (
    <div className="access-actions-field">
      <label htmlFor="grant-access-role">Access role</label>
      <CustomDropdown
        aria-label="Access role"
        aria-describedby={customSelected ? undefined : "grant-access-role-help"}
        id="grant-access-role"
        name="accessRoleChoice"
        required
        defaultValue=""
        placeholder="Choose an access role"
        options={[
          ...roles.map((role) => ({ value: role.id, label: role.name })),
          { value: CUSTOM_ACTIONS, label: "Custom actions" },
        ]}
        onValueChange={setChoice}
      />
      {selectedRole ? (
        <>
          <input type="hidden" name="accessRoleId" value={selectedRole.id} />
          <small className="access-form-field-help" id="grant-access-role-help">
            {selectedRole.description || "This role was set up for this product."}
          </small>
          <small className="access-form-field-help">
            Includes {selectedRole.actions.length} app permission
            {selectedRole.actions.length === 1 ? "" : "s"}.
          </small>
          <details className="access-role-details">
            <summary>Show action names</summary>
            <div className="access-role-actions">
              {selectedRole.actions.map((action) => (
                <code key={action}>{action}</code>
              ))}
            </div>
          </details>
        </>
      ) : null}
      {customSelected ? (
        <label className="access-custom-actions" htmlFor="grant-actions">
          Custom API actions
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
          Choose the role configured for this product that matches what this person needs to do.
        </small>
      ) : null}
    </div>
  );
}
