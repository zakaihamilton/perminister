import "server-only";

import { assertOpaqueId, type ProductRecord, type ProductVisibility, type SubjectId } from "../domain";
import { authMutationQueue } from "../mutation-queue";
import {
  listRecordsWithRecovery,
  loadRecord,
  persistRecord,
  requireOrganizationRoleUnlocked,
  store,
} from "./persistence";
import {
  hasAnotherPublicPublisher,
  organizationNamesForInstallationsUnlocked,
  sharedInstallationsForSource,
  withOrganizationProductMutation,
} from "./products";

export interface ArchivedProductEntry {
  product: ProductRecord;
  adopterOrganizations: Array<{ organizationId: string; name: string }>;
}

export interface ProductDeletionResult {
  productId: string;
  affectedOrganizationIds: string[];
  removedSharedInstallation: boolean;
}

async function revokeDetachedProductDataUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const members = await store().listOrganizationMemberships(organizationId, productId);
  for (const membership of members) {
    if (membership.productId !== productId) continue;
    const hasActiveGrant = (membership.permissionGrants ?? []).some(
      (grant) => grant.status === "active",
    );
    if (membership.status === "disabled" && !hasActiveGrant) continue;
    await persistRecord(
      {
        ...membership,
        status: "disabled",
        permissionGrants: (membership.permissionGrants ?? []).map((grant) => ({
          ...grant,
          status: "disabled",
          updatedAt: now,
        })),
        updatedAt: now,
      },
      "product.shared-membership-revoked",
      { kind: "subject", subjectId: actorId },
    );
  }

  const invitations = (await listRecordsWithRecovery("organization-invitation"))
    .map((entry) => entry.record)
    .filter(
      (invitation) =>
        invitation.organizationId === organizationId &&
        invitation.productId === productId &&
        !invitation.revokedAt &&
        !invitation.consumedAt,
    );
  for (const invitation of invitations) {
    await persistRecord({ ...invitation, revokedAt: now }, "product.shared-invitation-revoked", {
      kind: "subject",
      subjectId: actorId,
    });
  }

  const clients = (await listRecordsWithRecovery("consumer-client"))
    .map((entry) => entry.record)
    .filter((client) => client.organizationId === organizationId && client.productId === productId);
  for (const client of clients.filter((item) => item.status === "active")) {
    await persistRecord(
      { ...client, status: "revoked", revokedAt: now, updatedAt: now },
      "product.shared-client-revoked",
      { kind: "subject", subjectId: actorId },
    );
  }

  const clientIds = new Set<string>(clients.map((client) => client.consumerClientId));
  const sessions = (await listRecordsWithRecovery("session"))
    .map((entry) => entry.record)
    .filter(
      (session) =>
        !session.revokedAt &&
        !!session.applicationClientId &&
        clientIds.has(session.applicationClientId),
    );
  for (const session of sessions) {
    await persistRecord({ ...session, revokedAt: now }, "product.shared-session-revoked", {
      kind: "subject",
      subjectId: actorId,
    });
  }

  const principals = (await listRecordsWithRecovery("service-principal"))
    .map((entry) => entry.record)
    .filter(
      (principal) =>
        principal.organizationId === organizationId &&
        principal.productId === productId &&
        principal.status === "active",
    );
  for (const principal of principals) {
    await persistRecord(
      { ...principal, status: "disabled", updatedAt: now },
      "product.shared-service-principal-disabled",
      { kind: "subject", subjectId: actorId },
    );
  }

  const keys = (await listRecordsWithRecovery("api-key"))
    .map((entry) => entry.record)
    .filter(
      (key) =>
        key.scope.organizationId === organizationId &&
        key.scope.productId === productId &&
        key.status === "active",
    );
  for (const key of keys) {
    await persistRecord(
      { ...key, status: "revoked", revokedAt: now },
      "product.shared-key-revoked",
      { kind: "subject", subjectId: actorId },
    );
  }
}

async function setOrganizationProductArchivedState(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  action: "archive" | "restore",
): Promise<ProductRecord> {
  assertOpaqueId(productRecordId);
  return withOrganizationProductMutation(
    actorId,
    organizationId,
    productRecordId,
    (product) => [
      organizationId,
      ...(product.sharedProductRef ? [product.sharedProductRef.sourceOrganizationId] : []),
    ],
    async (actor, current) => {
      if (current.record.deletionStartedAt || current.record.deletedAt) {
        throw new Error(
          action === "archive"
            ? "This product is already being deleted."
            : "A product being deleted cannot be restored.",
        );
      }
      if (action === "archive") {
        if (current.record.archivedAt) return current.record;

        const now = new Date().toISOString();
        const archived = { ...current.record, archivedAt: now, updatedAt: now };
        await persistRecord(archived, "product.archived", {
          kind: "subject",
          subjectId: actor.subjectId,
        });
        return archived;
      }

      if (!current.record.archivedAt) return current.record;

      if (current.record.sharedProductRef) {
        const publisher = await store().readProduct(
          current.record.sharedProductRef.sourceOrganizationId,
          current.record.sharedProductRef.sourceProductId,
        );
        if (!publisher || publisher.visibility !== "public") {
          throw new Error("The product publisher is no longer available to restore this product.");
        }
      } else if (
        current.record.visibility === "public" &&
        hasAnotherPublicPublisher(
          current.record,
          await store().listProductsByProductId(current.record.productId),
        )
      ) {
        throw new Error(
          "Another organization now publishes a product with this ID. This archived product cannot be restored while that publisher is active.",
        );
      }

      const now = new Date().toISOString();
      const restored = { ...current.record, archivedAt: undefined, updatedAt: now };
      await persistRecord(restored, "product.restored", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return restored;
    },
  );
}

export function archiveOrganizationProduct(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
): Promise<ProductRecord> {
  return setOrganizationProductArchivedState(actorId, organizationId, productRecordId, "archive");
}

export function restoreOrganizationProduct(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
): Promise<ProductRecord> {
  return setOrganizationProductArchivedState(actorId, organizationId, productRecordId, "restore");
}

export async function listArchivedProductsForOrganization(
  actorId: SubjectId,
  organizationId: string,
): Promise<ArchivedProductEntry[]> {
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const products = (await listRecordsWithRecovery("product"))
      .map((entry) => entry.record)
      .filter(
        (product) =>
          product.organizationId === organizationId &&
          !product.deletedAt &&
          (!!product.archivedAt || !!product.deletionStartedAt),
      );
    return Promise.all(
      products.map(async (product) => ({
        product,
        adopterOrganizations: product.sharedProductRef
          ? []
          : await organizationNamesForInstallationsUnlocked(
              sharedInstallationsForSource(
                product,
                await store().listProductsByProductId(product.productId),
              ),
            ),
      })),
    );
  });
}

export async function deleteOrganizationProduct(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  confirmedRemoval = false,
): Promise<ProductDeletionResult> {
  assertOpaqueId(productRecordId);
  let isSharedInstallation = false;
  let lockIds: string[] = [];
  return withOrganizationProductMutation(
    actorId,
    organizationId,
    productRecordId,
    async (initial) => {
      isSharedInstallation = !!initial.sharedProductRef;
      const initialProducts = isSharedInstallation
        ? [initial]
        : await store().listProductsByProductId(initial.productId);
      const initialInstallations = isSharedInstallation
        ? [initial]
        : sharedInstallationsForSource(initial, initialProducts);
      lockIds = [
        organizationId,
        ...(isSharedInstallation
          ? [initial.sharedProductRef!.sourceOrganizationId]
          : initialInstallations.map((installation) => installation.organizationId)),
      ];
      return lockIds;
    },
    async (actor, current) => {
      let currentRecord = current;
      if (currentRecord.record.deletedAt) {
        return {
          productId: currentRecord.record.productId,
          affectedOrganizationIds: lockIds,
          removedSharedInstallation: isSharedInstallation,
        };
      }
      if (!currentRecord.record.archivedAt) {
        throw new Error("Archive this product before deleting it.");
      }

      const latestProducts = isSharedInstallation
        ? [currentRecord.record]
        : await store().listProductsByProductId(currentRecord.record.productId);
      const installations = isSharedInstallation
        ? [currentRecord.record]
        : sharedInstallationsForSource(currentRecord.record, latestProducts);
      const unheldOrganizations = installations
        .filter((installation) => !installation.sharedProductRef?.detachedAt)
        .map((installation) => installation.organizationId)
        .filter((id) => !lockIds.includes(id));
      if (unheldOrganizations.length) {
        throw new Error("Product installations changed. Retry deleting the archived product.");
      }
      const activeInstallations = installations.filter(
        (installation) => !installation.sharedProductRef?.detachedAt,
      );
      if (!isSharedInstallation && activeInstallations.length > 0 && !confirmedRemoval) {
        throw new Error("Confirm removing the product from its installed organizations.");
      }

      const now = new Date().toISOString();
      if (!currentRecord.record.deletionStartedAt) {
        const started = { ...currentRecord.record, deletionStartedAt: now, updatedAt: now };
        await persistRecord(
          started,
          "product.deletion-started",
          { kind: "subject", subjectId: actor.subjectId },
          { productName: started.name },
        );
        currentRecord = { ...currentRecord, record: started };
      }

      const affectedOrganizationIds = [
        ...new Set([
          ...lockIds,
          ...installations.map((installation) => installation.organizationId),
        ]),
      ];
      const cleanupTargets = isSharedInstallation
        ? [currentRecord.record]
        : [currentRecord.record, ...installations];
      for (const target of cleanupTargets) {
        await revokeDetachedProductDataUnlocked(
          actor.subjectId,
          target.organizationId,
          target.productId,
        );
      }

      if (!isSharedInstallation) {
        for (const installation of installations) {
          const reference = installation.sharedProductRef;
          if (!reference || reference.detachedAt || installation.deletedAt) continue;
          await persistRecord(
            {
              ...installation,
              sharedProductRef: { ...reference, detachedAt: now },
              deletedAt: now,
              updatedAt: now,
            },
            "product.shared-installation-removed",
            { kind: "subject", subjectId: actor.subjectId },
          );
        }
      } else if (!currentRecord.record.sharedProductRef?.detachedAt) {
        await persistRecord(
          {
            ...currentRecord.record,
            sharedProductRef: { ...currentRecord.record.sharedProductRef!, detachedAt: now },
            deletedAt: now,
            updatedAt: now,
          },
          "product.shared-installation-removed",
          { kind: "subject", subjectId: actor.subjectId },
        );
      }

      const latest = await loadRecord("product", productRecordId);
      if (latest && !latest.record.deletedAt) {
        await persistRecord(
          { ...latest.record, deletedAt: now, updatedAt: now },
          "product.deleted",
          { kind: "subject", subjectId: actor.subjectId },
          {
            affectedOrganizationIds,
            productName: latest.record.name,
            removedSharedInstallation: isSharedInstallation,
          },
        );
      }
      return {
        productId: currentRecord.record.productId,
        affectedOrganizationIds,
        removedSharedInstallation: isSharedInstallation,
      };
    },
  );
}

export async function setOrganizationProductVisibility(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  visibility: ProductVisibility,
  confirmedPrivateRemoval = false,
): Promise<ProductRecord> {
  assertOpaqueId(productRecordId);
  if (visibility !== "public" && visibility !== "private") {
    throw new Error("Choose public or private product visibility.");
  }
  return withOrganizationProductMutation(
    actorId,
    organizationId,
    productRecordId,
    async (initial) => {
      if (initial.sharedProductRef) throw new Error("Product not found.");
      const initialProducts = await store().listProductsByProductId(initial.productId);
      const initialInstallations = sharedInstallationsForSource(initial, initialProducts);
      return [organizationId, ...initialInstallations.map((entry) => entry.organizationId)];
    },
    async (actor, current) => {
      if (current.record.sharedProductRef) throw new Error("Product not found.");
      if (
        current.record.archivedAt ||
        current.record.deletionStartedAt ||
        current.record.deletedAt
      ) {
        throw new Error("This product is archived. Restore it before making changes.");
      }
      const currentProducts = await store().listProductsByProductId(current.record.productId);
      if (visibility === "public" && hasAnotherPublicPublisher(current.record, currentProducts)) {
        throw new Error("Another organization already publishes a product with this product ID.");
      }
      const installations = sharedInstallationsForSource(current.record, currentProducts);
      const activeInstallations = installations.filter(
        (installation) => !installation.sharedProductRef?.detachedAt,
      );
      if (visibility === "private" && activeInstallations.length && !confirmedPrivateRemoval) {
        throw new Error(
          "Confirm making this product private to remove it and revoke access in other organizations.",
        );
      }
      const currentVisibility = current.record.visibility === "public" ? "public" : "private";
      if (visibility === currentVisibility && visibility === "public") return current.record;
      if (visibility === "public") {
        const next = { ...current.record, visibility, updatedAt: new Date().toISOString() };
        await persistRecord(next, "product.published", {
          kind: "subject",
          subjectId: actor.subjectId,
        });
        return next;
      }

      for (const installation of installations) {
        await revokeDetachedProductDataUnlocked(
          actor.subjectId,
          installation.organizationId,
          installation.productId,
        );
        if (!installation.sharedProductRef?.detachedAt) {
          await persistRecord(
            {
              ...installation,
              sharedProductRef: {
                ...installation.sharedProductRef!,
                detachedAt: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            },
            "product.shared-installation-removed",
            { kind: "subject", subjectId: actor.subjectId },
          );
        }
      }
      if (currentVisibility === "private") return current.record;
      const next = {
        ...current.record,
        visibility: "private" as const,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "product.unpublished", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return next;
    },
  );
}
