import "server-only";

import {
  assertOpaqueId,
  newOrganizationMembershipId,
  newProductRecordId,
  type OrganizationId,
  type ProductId,
  type ProductRecord,
  type ProductVisibility,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import {
  listProductsByProductIdDuringRender,
  listRecordsWithRecovery,
  loadApprovedOrganizationUnlocked,
  loadRecord,
  persistRecord,
  requireOrganizationRoleUnlocked,
  store,
  withOrganizationMutationLocks,
} from "./persistence";
import {
  hasAnotherPublicPublisher,
  isSharedProductSource,
  organizationNamesForInstallationsUnlocked,
  refersToSharedProduct,
  sharedInstallationsForSource,
} from "./products";
import { organizationApprovalStatus } from "./validators";

export interface PublicProductCatalogEntry {
  product: ProductRecord;
  publisherOrganizationName: string;
  status: "available" | "installed" | "setup-required" | "conflict";
}

export interface ProductShareInfo {
  visibility: ProductVisibility;
  adopterOrganizations: Array<{ organizationId: string; name: string }>;
}

async function assignSharedProductOwnerUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<void> {
  const previousMembership = await store().readOrganizationMembership(
    organizationId,
    actorId,
    productId,
  );
  const now = new Date().toISOString();
  await persistRecord(
    {
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId:
        previousMembership?.organizationMembershipId ?? newOrganizationMembershipId(),
      organizationId: organizationId as OrganizationId,
      productId: productId as ProductId,
      subjectId: actorId,
      role: "owner",
      status: "active",
      permissionGrants:
        previousMembership?.status === "active" ? (previousMembership.permissionGrants ?? []) : [],
      createdAt: previousMembership?.createdAt ?? now,
      updatedAt: now,
    },
    "product.owner-assigned",
    { kind: "subject", subjectId: actorId },
  );
}

export async function listPublicProductsForOrganization(
  actorId: SubjectId,
  organizationId: string,
): Promise<PublicProductCatalogEntry[]> {
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const [products, organizations, memberships] = await Promise.all([
      listRecordsWithRecovery("product"),
      listRecordsWithRecovery("organization"),
      store().listOrganizationMemberships(organizationId),
    ]);
    const productsWithManager = new Set(
      memberships
        .filter(
          (membership) =>
            !!membership.productId &&
            membership.status === "active" &&
            (membership.role === "owner" || membership.role === "admin"),
        )
        .map((membership) => membership.productId!),
    );
    const organizationById = new Map(
      organizations.map((entry) => [entry.record.organizationId, entry.record]),
    );
    const localProducts = products
      .map((entry) => entry.record)
      .filter((product) => product.organizationId === organizationId);
    const catalog: PublicProductCatalogEntry[] = [];
    for (const source of products
      .map((entry) => entry.record)
      .filter(isSharedProductSource)
      .filter((product) => product.organizationId !== organizationId)) {
      const publisher = organizationById.get(source.organizationId);
      if (!publisher || organizationApprovalStatus(publisher) !== "approved") continue;
      const installed = localProducts.find((product) => product.productId === source.productId);
      let status: PublicProductCatalogEntry["status"] = "available";
      if (installed) {
        if (refersToSharedProduct(installed, source)) {
          status = installed.sharedProductRef?.detachedAt
            ? "available"
            : productsWithManager.has(source.productId)
              ? "installed"
              : "setup-required";
        } else {
          status = "conflict";
        }
      }
      catalog.push({ product: source, publisherOrganizationName: publisher.name, status });
    }
    return catalog.sort((left, right) => left.product.name.localeCompare(right.product.name));
  });
}

export async function installPublicProduct(
  actorId: SubjectId,
  organizationId: string,
  sourceProductRecordId: string,
): Promise<ProductRecord> {
  assertOpaqueId(sourceProductRecordId);
  return authMutationQueue.run(async () => {
    const initialSource = await loadRecord("product", sourceProductRecordId);
    if (!initialSource || !isSharedProductSource(initialSource.record)) {
      throw new Error("This public product is no longer available.");
    }
    const sourceOrganizationId = initialSource.record.organizationId;
    return withOrganizationMutationLocks([organizationId, sourceOrganizationId], async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
      const targetOrganization = await loadApprovedOrganizationUnlocked(organizationId);
      if (!targetOrganization) throw new Error("Organization not found.");
      const sourceRecord = await loadRecord("product", sourceProductRecordId);
      if (!sourceRecord || !isSharedProductSource(sourceRecord.record)) {
        throw new Error("This public product is no longer available.");
      }
      const source = sourceRecord.record;
      if (!(await loadApprovedOrganizationUnlocked(source.organizationId))) {
        throw new Error("This public product is no longer available.");
      }
      const localProducts = (await listRecordsWithRecovery("product"))
        .map((entry) => entry.record)
        .filter((product) => product.organizationId === organizationId);
      const existing = localProducts.find((product) => product.productId === source.productId);

      if (organizationId === source.organizationId) return source;
      if (existing && !refersToSharedProduct(existing, source)) {
        throw new Error(
          "A different product with this ID already exists in this organization. Resolve that conflict before adding the shared product.",
        );
      }
      if (existing && !existing.sharedProductRef?.detachedAt) {
        const installed = await store().readProduct(organizationId, source.productId);
        if (installed) {
          const memberships = await store().listOrganizationMemberships(
            organizationId,
            source.productId,
          );
          const hasProductManager = memberships.some(
            (membership) =>
              membership.productId === source.productId &&
              membership.status === "active" &&
              (membership.role === "owner" || membership.role === "admin"),
          );
          if (!hasProductManager) {
            await assignSharedProductOwnerUnlocked(actorId, organizationId, source.productId);
          }
          return installed;
        }
        throw new Error("This public product installation could not be loaded.");
      }

      const now = new Date().toISOString();
      const { stagedAccessRoleCatalog: _stagedAccessRoleCatalog, ...publishedSource } = source;
      const installation: ProductRecord = {
        ...publishedSource,
        productRecordId: existing?.productRecordId ?? newProductRecordId(),
        organizationId: organizationId as OrganizationId,
        visibility: "public",
        sharedProductRef: {
          sourceOrganizationId: source.organizationId,
          sourceProductRecordId: source.productRecordId,
          sourceProductId: source.productId,
          detachedAt: null,
        },
        createdBySubjectId: actorId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await persistRecord(
        installation,
        existing ? "product.shared-installation-reactivated" : "product.shared-installed",
        { kind: "subject", subjectId: actorId },
      );
      await assignSharedProductOwnerUnlocked(actorId, organizationId, source.productId);
      return installation;
    });
  });
}

export async function getProductShareInfo(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
): Promise<ProductShareInfo | null> {
  assertOpaqueId(productRecordId);
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const found = await loadRecord("product", productRecordId);
    if (!found || found.record.organizationId !== organizationId || found.record.sharedProductRef) {
      throw new Error("Product not found.");
    }
    const products = await listProductsByProductIdDuringRender(found.record.productId);
    if (!found.record.archivedAt && hasAnotherPublicPublisher(found.record, products)) return null;

    const installations = sharedInstallationsForSource(found.record, products);
    return {
      visibility: found.record.visibility === "public" ? "public" : "private",
      adopterOrganizations: await organizationNamesForInstallationsUnlocked(installations),
    };
  });
}
