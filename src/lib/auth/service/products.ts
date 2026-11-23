import "server-only";

import { cache } from "react";
import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  newOrganizationMembershipId,
  newProductRecordId,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type OrganizationRole,
  type ProductRecord,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { withRequestPerformanceSpan } from "../performance";
import { getOrganizationForSubject } from "./organizations";
import {
  listMembershipsForSubjectDuringRender,
  listProductsForOrganizationDuringRender,
  listRecordsWithRecovery,
  loadApprovedOrganizationUnlocked,
  loadRecord,
  loadSubjectUnlocked,
  organizationMembershipUnlocked,
  persistRecord,
  requireOrganizationRoleUnlocked,
  store,
  withOrganizationMutationLocks,
} from "./persistence";
import {
  normalizeProductDetails,
  type ProductDetailsInput,
  requireVerifiedActiveSubject,
  validateProductId,
} from "./validators";

export interface ProductMemberView {
  membership: OrganizationMembershipRecord;
  email: string | null;
  emailVerified: boolean;
}

export interface ProductAccessSummary {
  product: ProductRecord;
  membership: OrganizationMembershipRecord | null;
  catalogManager: boolean;
  catalogRole: OrganizationRole | null;
}

export function isSharedProductSource(product: ProductRecord): boolean {
  return (
    !product.sharedProductRef &&
    !product.archivedAt &&
    !product.deletionStartedAt &&
    !product.deletedAt &&
    product.visibility === "public"
  );
}

export function hasAnotherPublicPublisher(
  product: ProductRecord,
  products: readonly ProductRecord[],
): boolean {
  return products.some(
    (entry) =>
      entry.organizationId !== product.organizationId &&
      entry.productId === product.productId &&
      isSharedProductSource(entry),
  );
}

export function refersToSharedProduct(
  installation: ProductRecord,
  source: ProductRecord,
): boolean {
  const reference = installation.sharedProductRef;
  return (
    !!reference &&
    reference.sourceOrganizationId === source.organizationId &&
    reference.sourceProductRecordId === source.productRecordId &&
    reference.sourceProductId === source.productId
  );
}

export function isActiveSharedInstallationForSource(
  installation: ProductRecord,
  source: ProductRecord,
): boolean {
  return (
    installation.productId === source.productId &&
    installation.organizationId !== source.organizationId &&
    !installation.sharedProductRef?.detachedAt &&
    refersToSharedProduct(installation, source)
  );
}

export function sharedInstallationsForSource(
  source: ProductRecord,
  products: readonly ProductRecord[],
): ProductRecord[] {
  return products
    .filter((product) => product.organizationId !== source.organizationId)
    .filter((product) => refersToSharedProduct(product, source));
}

export async function organizationNamesForInstallationsUnlocked(
  installations: readonly ProductRecord[],
): Promise<Array<{ organizationId: string; name: string }>> {
  const activeInstallations = installations.filter(
    (installation) => !installation.sharedProductRef?.detachedAt,
  );
  const organizationIds = [...new Set(activeInstallations.map((item) => item.organizationId))];
  const organizations = await Promise.all(
    organizationIds.map(async (organizationId) => {
      const found = await loadRecord("organization", organizationId);
      return found ? ([organizationId, found.record] as const) : null;
    }),
  );
  const byId = new Map(
    organizations.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
  return activeInstallations
    .map((installation) => ({
      organizationId: installation.organizationId,
      name: byId.get(installation.organizationId)?.name ?? "Unknown organization",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function withOrganizationProductMutation<Result>(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  lockIdsForProduct: (
    product: ProductRecord,
  ) => readonly string[] | Promise<readonly string[]>,
  operation: (
    actor: OrganizationMembershipRecord,
    current: { record: ProductRecord },
  ) => Result | Promise<Result>,
): Promise<Result> {
  return authMutationQueue.run(async () => {
    const initial = await loadRecord("product", productRecordId);
    if (!initial || initial.record.organizationId !== organizationId) {
      throw new Error("Product not found.");
    }
    if (initial.record.pendingMove) {
      throw new Error("A product move is in progress. Resume it before making changes.");
    }
    const lockIds = await lockIdsForProduct(initial.record);
    return withOrganizationMutationLocks(lockIds, async () => {
      const actor = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("product", productRecordId);
      if (!current || current.record.organizationId !== organizationId) {
        throw new Error("Product not found.");
      }
      if (current.record.pendingMove) {
        throw new Error("A product move is in progress. Resume it before making changes.");
      }
      return operation(actor, current);
    });
  });
}

export async function requireProductMoveOwner(
  actorId: SubjectId,
  organizationId: string,
  allowPendingMoveRecovery: boolean,
): Promise<OrganizationMembershipRecord> {
  if (!allowPendingMoveRecovery) {
    return requireOrganizationRoleUnlocked(actorId, organizationId, ["owner"]);
  }

  assertOpaqueId(organizationId);
  const [actor, organization, membership] = await Promise.all([
    loadSubjectUnlocked(actorId),
    loadRecord("organization", organizationId),
    store().readOrganizationMembership(organizationId, actorId),
  ]);
  requireVerifiedActiveSubject(actor);
  if (
    !organization ||
    !membership ||
    membership.status !== "active" ||
    membership.role !== "owner"
  ) {
    throw new Error("You do not have permission to manage this organization.");
  }
  return membership;
}

export async function createOrganizationProduct(
  actorId: SubjectId,
  organizationId: string,
  input: ProductDetailsInput,
): Promise<ProductRecord> {
  const productId = validateProductId(input.productId);
  const details = normalizeProductDetails(input);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const manager = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const allProducts = (await listRecordsWithRecovery("product")).map((item) => item.record);
      if (
        allProducts.some(
          (product) =>
            product.productId === productId &&
            product.pendingMove?.destinationOrganizationId === organizationId,
        )
      ) {
        throw new Error("This product ID is reserved by an incomplete move. Resume it first.");
      }
      const products = allProducts.filter(
        (product) => product.organizationId === organizationId && product.productId === productId,
      );
      const prior = products.find((product) => !product.sharedProductRef?.detachedAt);
      const reusableTombstone = products.find((product) => !!product.sharedProductRef?.detachedAt);
      if (prior) {
        throw new Error("That product ID is already in use in this organization.");
      }
      const now = new Date().toISOString();
      const product: ProductRecord = {
        kind: "product",
        schemaVersion: 1,
        productRecordId: reusableTombstone?.productRecordId ?? newProductRecordId(),
        organizationId: organizationId as OrganizationId,
        productId,
        ...details,
        visibility: "private",
        createdBySubjectId: actorId,
        createdAt: reusableTombstone?.createdAt ?? now,
        updatedAt: now,
      };
      await persistRecord(product, "product.created", {
        kind: "subject",
        subjectId: manager.subjectId,
      });
      const existingOwnerMembership = await store().readOrganizationMembership(
        organizationId,
        actorId,
        productId,
      );
      const ownerMembership: OrganizationMembershipRecord = {
        kind: "organization-membership",
        schemaVersion: 1,
        organizationMembershipId:
          existingOwnerMembership?.organizationMembershipId ?? newOrganizationMembershipId(),
        organizationId: organizationId as OrganizationId,
        productId,
        subjectId: actorId,
        role: "owner",
        status: "active",
        permissionGrants: [],
        createdAt: existingOwnerMembership?.createdAt ?? now,
        updatedAt: now,
      };
      await persistRecord(
        ownerMembership,
        "product.owner-assigned",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          changes: [{ field: "role", before: "None", after: ownerMembership.role }],
        },
      );
      return product;
    }),
  );
}

export async function updateOrganizationProduct(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  input: Omit<ProductDetailsInput, "productId">,
): Promise<ProductRecord> {
  assertOpaqueId(productRecordId);
  const details = normalizeProductDetails(input);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const manager = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("product", productRecordId);
      if (!current || current.record.organizationId !== organizationId)
        throw new Error("Product not found.");
      if (current.record.sharedProductRef) {
        throw new Error("Shared product details are controlled by the publishing organization.");
      }
      if (current.record.pendingMove) {
        throw new Error("A product move is in progress. Resume it before making changes.");
      }
      if (current.record.archivedAt) {
        throw new Error("This product is archived. Restore it before making changes.");
      }
      const next: ProductRecord = {
        ...current.record,
        ...details,
        updatedAt: new Date().toISOString(),
      };
      if (next.websiteUrl !== current.record.websiteUrl) {
        delete next.stagedAccessRoleCatalog;
      }
      await persistRecord(next, "product.updated", {
        kind: "subject",
        subjectId: manager.subjectId,
      });
      return next;
    }),
  );
}

export const listProductsForOrganization = cache(async function listProductsForOrganization(
  subjectId: SubjectId,
  organizationId: string,
): Promise<ProductRecord[]> {
  return authMutationQueue.read(async () => {
    const [organization, products] = await Promise.all([
      withRequestPerformanceSpan("dashboard.selected-organization", () =>
        getOrganizationForSubject(subjectId, organizationId),
      ),
      listProductsForOrganizationDuringRender(organizationId),
    ]);
    const memberRows = organization.catalogManager
      ? []
      : await listMembershipsForSubjectDuringRender(subjectId);
    const allowedProducts = new Set(
      memberRows
        .filter(
          (row) =>
            row.organizationId === organizationId && row.productId && row.status === "active",
        )
        .map((row) => row.productId!),
    );
    if (!organization.catalogManager && allowedProducts.size === 0) {
      throw new Error("Organization not found.");
    }
    return products
      .filter(
        (product) =>
          !product.archivedAt &&
          !product.deletionStartedAt &&
          !product.deletedAt &&
          (organization.catalogManager || allowedProducts.has(product.productId)),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  });
});

export async function getProductForOrganization(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  return authMutationQueue.read(async () => {
    return getProductAccessUnlocked(subjectId, organizationId, productId).then(
      ({ product }) => product,
    );
  });
}

async function getProductAccessUnlocked(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductAccessSummary> {
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
  const organization = await loadApprovedOrganizationUnlocked(organizationId);
  if (!organization) {
    if (!product.pendingMove) throw new Error("Organization not found.");
    await requireProductMoveOwner(subjectId, product.pendingMove.sourceOrganizationId, true);
    await requireProductMoveOwner(subjectId, product.pendingMove.destinationOrganizationId, true);
  }
  const [catalog, membership] = await Promise.all([
    organizationMembershipUnlocked(organizationId, subjectId),
    store().readOrganizationMembership(organizationId, subjectId, productId),
  ]);
  if (!catalog && (!membership || membership.status !== "active")) {
    throw new Error("Product not found.");
  }
  return {
    product,
    membership: membership?.status === "active" ? membership : null,
    catalogManager: !!catalog,
    catalogRole: catalog?.role ?? null,
  };
}

export async function getProductAccessForSubject(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductAccessSummary> {
  return authMutationQueue.read(() =>
    getProductAccessUnlocked(subjectId, organizationId, productId),
  );
}
