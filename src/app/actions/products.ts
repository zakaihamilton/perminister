import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { consumeProductLookupRateLimit } from "@/lib/auth/coordination";
import type { ProductVisibility, SubjectId } from "@/lib/auth/domain";
import {
  archiveOrganizationProduct,
  createOrganizationProduct,
  deleteOrganizationProduct,
  getCurrentSession,
  getOrganizationForSubject,
  getProductMoveRecoveryState,
  getProductShareInfo,
  installPublicProduct,
  movePrivateProductForOrganizationOwner,
  restoreOrganizationProduct,
  setOrganizationProductVisibility,
  transferPublicProductForAdministrator,
  transferPublicProductForOrganizationOwner,
  updateOrganizationProduct,
} from "@/lib/auth/service";
import { operationsHref } from "@/lib/operations-navigation";
import {
  firstValue,
  publicActionError,
  requireOperationsAdministratorContext,
} from "./shared";

export interface ProductLookupState {
  error?: string;
  suggestion?: { name: string; description: string; websiteUrl: string; iconUrl: string };
  source?: string;
}

function revalidateTransferredProductPaths(transfer: {
  affectedOrganizationIds: string[];
  product: { productId: string };
}): void {
  revalidatePath("/dashboard/operations/shared-products");
  for (const organizationId of transfer.affectedOrganizationIds) {
    revalidatePath(`/dashboard/${encodeURIComponent(organizationId)}/products`);
    revalidatePath(
      `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(transfer.product.productId)}`,
    );
  }
}

function revalidateProductLifecyclePaths(
  organizationIds: readonly string[],
  productId: string,
): void {
  revalidatePath("/dashboard/operations/shared-products");
  for (const organizationId of new Set(organizationIds)) {
    const organizationPath = `/dashboard/${encodeURIComponent(organizationId)}`;
    const productPath = `${organizationPath}/products/${encodeURIComponent(productId)}`;
    revalidatePath(organizationPath);
    revalidatePath(`${organizationPath}/products`);
    revalidatePath(productPath);
    revalidatePath(`${organizationPath}/api-keys`);
    revalidatePath(`${organizationPath}/api-keys/new`);
  }
}

async function organizationProductActionContext(formData: FormData) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  return {
    current,
    organizationId: firstValue(formData, "organizationId"),
    productRecordId: firstValue(formData, "productRecordId"),
    productId: firstValue(formData, "productId"),
  };
}

async function requireProductActionContext(formData: FormData) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  return {
    current,
    sourceOrganizationId: firstValue(formData, "sourceOrganizationId"),
    productRecordId: firstValue(formData, "productRecordId"),
    productId: firstValue(formData, "productId"),
  };
}

async function updateOrganizationProductArchivedState(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  productId: string,
  updateState: typeof archiveOrganizationProduct,
): Promise<void> {
  let affectedOrganizationIds = [organizationId];
  try {
    const shareInfo = await getProductShareInfo(actorId, organizationId, productRecordId).catch(
      () => null,
    );
    await updateState(actorId, organizationId, productRecordId);
    affectedOrganizationIds = [
      organizationId,
      ...(shareInfo?.adopterOrganizations.map((entry) => entry.organizationId) ?? []),
    ];
  } catch (error) {
    redirect(
      `/dashboard/${encodeURIComponent(organizationId)}/products?error=product-lifecycle&reason=${encodeURIComponent(publicActionError(error))}`,
    );
  }
  revalidateProductLifecyclePaths(affectedOrganizationIds, productId);
}

async function updateOrganizationProductArchivedStateAction(
  formData: FormData,
  updateState: typeof archiveOrganizationProduct,
  notice: string,
): Promise<void> {
  const { current, organizationId, productRecordId, productId } =
    await organizationProductActionContext(formData);
  await updateOrganizationProductArchivedState(
    current.subject.subjectId,
    organizationId,
    productRecordId,
    productId,
    updateState,
  );
  redirect(`/dashboard/${encodeURIComponent(organizationId)}/products?notice=${notice}`);
}

export async function createOrganizationProductAction(formData: FormData): Promise<void> {
  const { current, organizationId } = await organizationProductActionContext(formData);
  let productId: string;
  try {
    const product = await createOrganizationProduct(current.subject.subjectId, organizationId, {
      productId: firstValue(formData, "productId"),
      name: firstValue(formData, "name"),
      description: firstValue(formData, "description"),
      websiteUrl: firstValue(formData, "websiteUrl"),
      iconUrl: firstValue(formData, "iconUrl"),
    });
    productId = product.productId;
  } catch (error) {
    const message = encodeURIComponent(publicActionError(error));
    redirect(`/dashboard/${organizationId}/products/new?error=${message}`);
  }
  redirect(
    `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}?notice=product-created`,
  );
}

export async function updateOrganizationProductAction(formData: FormData): Promise<void> {
  const { current, organizationId } = await organizationProductActionContext(formData);
  let productId: string;
  try {
    const product = await updateOrganizationProduct(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "productRecordId"),
      {
        name: firstValue(formData, "name"),
        description: firstValue(formData, "description"),
        websiteUrl: firstValue(formData, "websiteUrl"),
        iconUrl: firstValue(formData, "iconUrl"),
      },
    );
    productId = product.productId;
  } catch {
    redirect(`/dashboard/${organizationId}/products?error=product-update`);
  }
  redirect(
    `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}?notice=product-updated`,
  );
}

export async function addPublicProductAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  let product: Awaited<ReturnType<typeof installPublicProduct>>;
  try {
    product = await installPublicProduct(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "sourceProductRecordId"),
    );
  } catch (error) {
    redirect(
      `/dashboard/${organizationId}/products?error=${encodeURIComponent(publicActionError(error))}`,
    );
  }
  revalidatePath(`/dashboard/${organizationId}/products`);
  redirect(
    `/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}?notice=product-added`,
  );
}

export async function transferPublicProductAction(formData: FormData): Promise<void> {
  const { current, organizationId: operationsOrganizationId } =
    await requireOperationsAdministratorContext(formData);

  let transfer: Awaited<ReturnType<typeof transferPublicProductForAdministrator>>;
  try {
    transfer = await transferPublicProductForAdministrator(
      current.subject.subjectId,
      firstValue(formData, "productRecordId"),
      firstValue(formData, "destinationOrganizationId"),
    );
  } catch (error) {
    const message = encodeURIComponent(publicActionError(error));
    redirect(
      operationsHref(
        `/dashboard/operations/shared-products?error=product-transfer&reason=${message}`,
        operationsOrganizationId,
      ),
    );
  }

  revalidateTransferredProductPaths(transfer);
  redirect(
    operationsHref(
      "/dashboard/operations/shared-products?notice=product-transferred",
      operationsOrganizationId,
    ),
  );
}

export async function transferOwnedPublicProductAction(formData: FormData): Promise<void> {
  const { current, sourceOrganizationId, productRecordId, productId } =
    await requireProductActionContext(formData);
  const returnTo = `/dashboard/${encodeURIComponent(sourceOrganizationId)}/products/${encodeURIComponent(
    productId,
  )}`;

  let transfer: Awaited<ReturnType<typeof transferPublicProductForOrganizationOwner>>;
  try {
    transfer = await transferPublicProductForOrganizationOwner(
      current.subject.subjectId,
      sourceOrganizationId,
      productRecordId,
      firstValue(formData, "destinationOrganizationId"),
    );
  } catch (error) {
    const reason = encodeURIComponent(publicActionError(error));
    redirect(`${returnTo}?error=product-transfer&reason=${reason}`);
  }

  revalidateTransferredProductPaths(transfer);
  redirect(
    `/dashboard/${encodeURIComponent(transfer.destinationOrganizationId)}/products/${encodeURIComponent(transfer.product.productId)}?notice=product-transferred`,
  );
}

export async function movePrivateProductAction(formData: FormData): Promise<void> {
  const { current, sourceOrganizationId, productRecordId, productId } =
    await requireProductActionContext(formData);
  const destinationOrganizationId = firstValue(formData, "destinationOrganizationId");

  let move: Awaited<ReturnType<typeof movePrivateProductForOrganizationOwner>>;
  try {
    move = await movePrivateProductForOrganizationOwner(
      current.subject.subjectId,
      sourceOrganizationId,
      productRecordId,
      destinationOrganizationId,
    );
  } catch (error) {
    const recovery = await getProductMoveRecoveryState(
      current.subject.subjectId,
      productRecordId,
    ).catch(() => null);
    const returnOrganizationId = recovery?.organizationId ?? sourceOrganizationId;
    const returnProductId = recovery?.productId ?? productId;
    if (recovery?.organizationId === destinationOrganizationId && !recovery.pending) {
      redirect(
        `/dashboard/${encodeURIComponent(destinationOrganizationId)}/products/${encodeURIComponent(returnProductId)}?notice=product-moved`,
      );
    }
    const reason = encodeURIComponent(
      recovery?.pending
        ? "The product move was interrupted. Resume it from this page."
        : publicActionError(error),
    );
    redirect(
      `/dashboard/${encodeURIComponent(returnOrganizationId)}/products/${encodeURIComponent(returnProductId)}?error=product-move&reason=${reason}`,
    );
  }

  revalidateTransferredProductPaths(move);
  redirect(
    `/dashboard/${encodeURIComponent(move.destinationOrganizationId)}/products/${encodeURIComponent(move.product.productId)}?notice=product-moved`,
  );
}

export async function archiveOrganizationProductAction(formData: FormData): Promise<void> {
  await updateOrganizationProductArchivedStateAction(
    formData,
    archiveOrganizationProduct,
    "product-archived",
  );
}

export async function restoreOrganizationProductAction(formData: FormData): Promise<void> {
  await updateOrganizationProductArchivedStateAction(
    formData,
    restoreOrganizationProduct,
    "product-restored",
  );
}

export async function deleteOrganizationProductAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productRecordId = firstValue(formData, "productRecordId");
  let deletion: Awaited<ReturnType<typeof deleteOrganizationProduct>>;
  try {
    deletion = await deleteOrganizationProduct(
      current.subject.subjectId,
      organizationId,
      productRecordId,
      firstValue(formData, "confirmedRemoval") === "true",
    );
  } catch (error) {
    redirect(
      `/dashboard/${encodeURIComponent(organizationId)}/products?error=product-lifecycle&reason=${encodeURIComponent(publicActionError(error))}`,
    );
  }
  revalidateProductLifecyclePaths(deletion.affectedOrganizationIds, deletion.productId);
  redirect(
    `/dashboard/${encodeURIComponent(organizationId)}/products?notice=${deletion.removedSharedInstallation ? "shared-product-removed" : "product-deleted"}`,
  );
}

export async function setOrganizationProductVisibilityAction(formData: FormData): Promise<void> {
  const { current, organizationId, productRecordId, productId } =
    await organizationProductActionContext(formData);
  const visibilityValue = firstValue(formData, "visibility");
  const returnTo = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}`;
  if (visibilityValue !== "private" && visibilityValue !== "public") {
    redirect(`${returnTo}?error=product-visibility-invalid`);
  }
  let before: Awaited<ReturnType<typeof getProductShareInfo>>;
  try {
    before = await getProductShareInfo(current.subject.subjectId, organizationId, productRecordId);
    if (!before) throw new Error("Product availability is managed by its publishing organization.");
    await setOrganizationProductVisibility(
      current.subject.subjectId,
      organizationId,
      productRecordId,
      visibilityValue as ProductVisibility,
      firstValue(formData, "confirmedPrivateRemoval") === "true",
    );
  } catch (error) {
    const requiresConfirmation =
      error instanceof Error && error.message.startsWith("Confirm making this product private");
    redirect(
      requiresConfirmation
        ? `${returnTo}?error=product-private-confirmation`
        : `${returnTo}?error=product-visibility-update`,
    );
  }
  for (const affectedOrganization of [
    organizationId,
    ...before.adopterOrganizations.map((organization) => organization.organizationId),
  ]) {
    revalidatePath(`/dashboard/${affectedOrganization}/products`);
    revalidatePath(`/dashboard/${affectedOrganization}/products/${encodeURIComponent(productId)}`);
  }
  redirect(`${returnTo}?notice=product-visibility-updated`);
}

export async function lookupProductWebsiteAction(
  _previous: ProductLookupState,
  formData: FormData,
): Promise<ProductLookupState> {
  const source = firstValue(formData, "source").trim();
  const organizationId = firstValue(formData, "organizationId");
  if (!source || source.length > 2048) {
    return { error: "Enter a website address up to 2,048 characters.", source };
  }
  const current = await getCurrentSession();
  if (!current) return { error: "Sign in before looking up product details.", source };
  try {
    const organization = await getOrganizationForSubject(current.subject.subjectId, organizationId);
    if (organization.membership.role !== "owner" && organization.membership.role !== "admin") {
      return { error: "Only organization owners and admins can look up product details.", source };
    }
    if (!(await consumeProductLookupRateLimit(organizationId, current.subject.subjectId))) {
      return { error: "Too many product lookups. Try again in a minute.", source };
    }
    const { fetchProductSiteSuggestion } = await import("@/lib/product-discovery");
    const suggestion = await fetchProductSiteSuggestion(source);
    return { suggestion, source: suggestion.websiteUrl };
  } catch (error) {
    return { error: publicActionError(error), source };
  }
}
