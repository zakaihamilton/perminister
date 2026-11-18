"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ProductAccessRoleActionState } from "@/app/actions";
import type { ProductAccessRole } from "@/lib/auth/access-roles";
import { submitStableAction } from "@/lib/action-client";

export function EditProductAccessRoleFormClient({
  accessRole,
  organizationId,
  productId,
  rolesPath,
  initialError,
}: {
  accessRole: ProductAccessRole;
  organizationId: string;
  productId: string;
  rolesPath: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState(initialError ?? "");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await submitStableAction<ProductAccessRoleActionState>(
        "updateProductAccessRoleAction",
        new FormData(event.currentTarget),
      );
      if (result.updated) {
        router.push(`${rolesPath}?notice=access-role-updated`);
        return;
      }
      setError(
        result.error ?? "This permission set could not be saved. Check your access and try again.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action="/actions/updateProductAccessRoleAction"
      className="auth-form access-role-create-form"
      method="post"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="accessRoleId" value={accessRole.id} />
      <label>
        Permission set name
        <input
          defaultValue={accessRole.name}
          maxLength={80}
          name="roleName"
          placeholder="For example, Telemetry viewer"
          required
        />
      </label>
      <label>
        Description <span className="form-hint">Optional</span>
        <input
          defaultValue={accessRole.description}
          maxLength={240}
          name="roleDescription"
          placeholder="What a person with this role can do"
        />
      </label>
      <label>
        App permissions
        <textarea
          aria-describedby="access-role-actions-help"
          defaultValue={accessRole.actions.join(", ")}
          maxLength={2110}
          name="actions"
          placeholder="Enter exact action names, separated by commas"
          required
          rows={2}
        />
        <small className="access-form-field-help" id="access-role-actions-help">
          Ask the app developer if you do not know the exact action names.
        </small>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button-primary" disabled={pending} type="submit">
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
