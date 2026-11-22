import "server-only";

import { redirect } from "next/navigation";
import type { ResourceScope } from "@/lib/auth/domain";
import {
  createApiKeyForSubject,
  createPermissionGrant,
  deletePermissionGrant,
  getCurrentSession,
  revokeApiKeyForSubject,
  updateGrantStatus,
} from "@/lib/auth/service";
import { dashboardReturnTo, firstValue, publicActionError } from "./shared";

export interface CreateApiKeyState {
  token?: string;
  warning?: string;
  error?: string;
}

function parseScope(data: FormData): ResourceScope {
  const kind = firstValue(data, "scopeKind");
  const organizationId = firstValue(data, "organizationId").toLowerCase();
  const productId = firstValue(data, "productId").trim().toLowerCase();
  if (kind === "product")
    return { kind, organizationId: organizationId as ResourceScope["organizationId"], productId };
  const resourceId = firstValue(data, "resourceId").trim().toLowerCase();
  if (kind === "project")
    return {
      kind,
      organizationId: organizationId as ResourceScope["organizationId"],
      productId,
      projectId: resourceId,
    };
  if (kind === "workspace")
    return {
      kind,
      organizationId: organizationId as ResourceScope["organizationId"],
      productId,
      workspaceId: resourceId,
    };
  throw new Error("Choose a supported permission scope.");
}

function parseActions(data: FormData): string[] {
  return firstValue(data, "actions")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function createApiKeyAction(
  _previous: CreateApiKeyState,
  formData: FormData,
): Promise<CreateApiKeyState> {
  const current = await getCurrentSession();
  if (!current) return { error: "Sign in again to create an API key." };
  try {
    const expiration = firstValue(formData, "expiresInDays");
    const expiresAt =
      expiration === "never"
        ? null
        : new Date(Date.now() + Number(expiration) * 24 * 60 * 60 * 1000).toISOString();
    const created = await createApiKeyForSubject(current.subject.subjectId, {
      scope: parseScope(formData),
      actions: parseActions(formData),
      expiresAt,
      rotateFromApiKeyId: firstValue(formData, "rotateFromApiKeyId") || undefined,
    });
    return { token: created.token, warning: created.rotationWarning ?? undefined };
  } catch (error) {
    return { error: publicActionError(error) };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  try {
    await revokeApiKeyForSubject(current.subject.subjectId, firstValue(formData, "apiKeyId"));
  } catch {
    redirect(`${dashboardReturnTo(formData)}?error=key-revoke-failed`);
  }
  redirect(`${dashboardReturnTo(formData)}?notice=key-revoked`);
}

export async function createGrantAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  try {
    const accessRoleId = firstValue(formData, "accessRoleId").trim();
    await createPermissionGrant(
      current.subject.subjectId,
      firstValue(formData, "subjectId"),
      parseScope(formData),
      accessRoleId ? [] : parseActions(formData),
      accessRoleId || undefined,
    );
  } catch {
    redirect(
      `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access?error=grant-failed`,
    );
  }
  redirect(
    `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access?notice=grant-created`,
  );
}

export async function updateGrantStatusAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const status = firstValue(formData, "status");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const accessPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`;
  if (status !== "active" && status !== "disabled") redirect(`${accessPath}?error=grant-failed`);
  try {
    await updateGrantStatus(
      current.subject.subjectId,
      firstValue(formData, "membershipId"),
      status,
    );
  } catch {
    redirect(`${accessPath}?error=grant-failed`);
  }
  redirect(`${accessPath}?notice=grant-updated`);
}

export async function deletePermissionGrantAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const accessPath = `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(
    productId,
  )}/access`;
  try {
    await deletePermissionGrant(current.subject.subjectId, firstValue(formData, "membershipId"));
  } catch {
    redirect(`${accessPath}?error=grant-delete-failed`);
  }
  redirect(`${accessPath}?notice=grant-deleted`);
}
