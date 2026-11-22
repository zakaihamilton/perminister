import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SubjectId } from "@/lib/auth/domain";
import {
  applyProductAccessRoleCatalog,
  createProductAccessRole,
  getCurrentSession,
  removeProductAccessRole,
  stageProductAccessRoleCatalog,
  updateProductAccessRole,
} from "@/lib/auth/service";
import { firstValue } from "./shared";

export interface ProductAccessRoleActionState {
  updated?: boolean;
  error?: string;
}

async function runProductAccessRoleAction(
  formData: FormData,
  notice: "access-role-created" | "access-role-removed",
  mutation: (subjectId: SubjectId, organizationId: string, productId: string) => Promise<unknown>,
): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const rolesPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`;
  try {
    await mutation(current.subject.subjectId, organizationId, productId);
  } catch {
    redirect(`${rolesPath}?error=access-role`);
  }
  redirect(`${rolesPath}?notice=${notice}`);
}

export async function createProductAccessRoleAction(formData: FormData): Promise<void> {
  await runProductAccessRoleAction(
    formData,
    "access-role-created",
    (subjectId, organizationId, productId) =>
      createProductAccessRole(subjectId, organizationId, productId, {
        name: firstValue(formData, "roleName"),
        description: firstValue(formData, "roleDescription"),
        actions: firstValue(formData, "actions").split(/[\n,]/),
      }),
  );
}

function productAccessRoleUpdateError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "This permission set could not be saved. Check your access and try again.";
  }
  if (error.message === "An access role with that name already exists.") {
    return "A permission set with that name already exists. Choose another name.";
  }
  if (error.message === "Enter a role name up to 80 characters.") {
    return "Enter a permission set name with 1–80 characters.";
  }
  if (error.message === "The role description must be 240 characters or fewer.") {
    return "Keep the description within 240 characters.";
  }
  if (error.message === "Enter 1 to 32 valid action names.") return error.message;
  if (error.message === "Access role not found.") {
    return "This permission set is no longer available. Return to the list and reopen it.";
  }
  if (error.message === "You do not have permission to manage this product.") {
    return "You do not have permission to edit this permission set.";
  }
  if (error.message === "Organization is busy. Try again shortly.") return error.message;
  return "This permission set could not be saved. Check your access and try again.";
}

export async function updateProductAccessRoleAction(
  formData: FormData,
): Promise<ProductAccessRoleActionState> {
  const current = await getCurrentSession();
  if (!current) return { error: "Sign in again to update this permission set." };

  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const accessRoleId = firstValue(formData, "accessRoleId");
  try {
    await updateProductAccessRole(
      current.subject.subjectId,
      organizationId,
      productId,
      accessRoleId,
      {
        name: firstValue(formData, "roleName"),
        description: firstValue(formData, "roleDescription"),
        actions: firstValue(formData, "actions").split(/[\n,]/),
      },
    );
  } catch (error) {
    return { error: productAccessRoleUpdateError(error) };
  }

  const rolesPath = `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/roles`;
  const editPath = `${rolesPath}/${encodeURIComponent(accessRoleId)}/edit`;
  revalidatePath(rolesPath);
  revalidatePath(editPath);
  return { updated: true };
}

export async function removeProductAccessRoleAction(formData: FormData): Promise<void> {
  await runProductAccessRoleAction(
    formData,
    "access-role-removed",
    (subjectId, organizationId, productId) =>
      removeProductAccessRole(
        subjectId,
        organizationId,
        productId,
        firstValue(formData, "accessRoleId"),
      ),
  );
}

function productRoleCatalogPath(organizationId: string, productId: string) {
  return `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/roles/catalog`;
}

async function runProductRoleCatalogAction(
  formData: FormData,
  error: "role-catalog-fetch" | "role-catalog-apply",
  notice: "role-catalog-staged" | "role-catalog-applied",
  mutation: (subjectId: SubjectId, organizationId: string, productId: string) => Promise<unknown>,
  refreshAccess = false,
): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const catalogPath = productRoleCatalogPath(organizationId, productId);
  try {
    await mutation(current.subject.subjectId, organizationId, productId);
  } catch {
    redirect(`${catalogPath}?error=${error}`);
  }
  revalidatePath(catalogPath);
  const encodedProductPath = `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}`;
  revalidatePath(`${encodedProductPath}/roles`);
  if (refreshAccess) revalidatePath(`${encodedProductPath}/access`);
  redirect(`${catalogPath}?notice=${notice}`);
}

export async function fetchProductAccessRoleCatalogAction(formData: FormData): Promise<void> {
  await runProductRoleCatalogAction(
    formData,
    "role-catalog-fetch",
    "role-catalog-staged",
    stageProductAccessRoleCatalog,
  );
}

export async function applyProductAccessRoleCatalogAction(formData: FormData): Promise<void> {
  await runProductRoleCatalogAction(
    formData,
    "role-catalog-apply",
    "role-catalog-applied",
    applyProductAccessRoleCatalog,
    true,
  );
}
