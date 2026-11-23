import "server-only";

import {
  type AuthEvent,
  assertOpaqueId,
  type EventId,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type OrganizationRecord,
  type PendingProductMove,
  type ProductRecord,
  type ProductRecordId,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { invalidateOrganizationDashboardDataCache } from "./dashboard-cache";
import {
  appendRecordActivityEvent,
  listProductsByProductIdDuringRender,
  listRecordsWithRecovery,
  loadApprovedOrganizationUnlocked,
  loadRecord,
  persistRecord,
  requireAdministrator,
  requireOrganizationRoleUnlocked,
  store,
  withOrganizationMutationLocks,
} from "./persistence";
import {
  isActiveSharedInstallationForSource,
  isSharedProductSource,
  refersToSharedProduct,
  requireProductMoveOwner,
} from "./products";
import {
  deterministicUuidFromSeed,
  eventPayloadId,
  organizationApprovalStatus,
} from "./validators";

export interface AdministratorPublicProductTransferEntry {
  product: ProductRecord;
  publisherOrganizationName: string;
  adopterCount: number;
  destinations: ProductTransferDestination[];
  pendingDestinationOrganizationId?: string;
}

export interface ProductTransferDestination {
  organizationId: string;
  name: string;
  disabledReason?: string;
  transferNotice?: string;
}

export interface OrganizationProductTransferOptions {
  destinations: ProductTransferDestination[];
  pendingDestinationOrganizationId?: string;
}

export interface OrganizationProductMoveOptions {
  sourceOrganizationId: string;
  destinations: ProductTransferDestination[];
  pendingDestinationOrganizationId?: string;
}

export interface PrivateProductMoveResult {
  product: ProductRecord;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  affectedOrganizationIds: string[];
}

export interface ProductMoveRecoveryState {
  organizationId: string;
  pending: boolean;
  productId: string;
}

export interface PublicProductTransferResult {
  product: ProductRecord;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  affectedOrganizationIds: string[];
}

type PublicProductTransferAuthority = "administrator" | "organization-owner";

function publicProductTransferTargetId(
  sourceProductRecordId: ProductRecordId,
  destinationOrganizationId: string,
): ProductRecordId {
  return deterministicUuidFromSeed(
    `perminister:public-product-transfer:v1:${sourceProductRecordId}:${destinationOrganizationId}`,
  ) as ProductRecordId;
}

async function completedProductTransferTargetsUnlocked(
  sourceProductRecordId: ProductRecordId,
): Promise<Set<string>> {
  const events = await store().listEvents({ kind: "product", id: sourceProductRecordId });
  return new Set(
    events
      .filter((event) => event.type === "product.transferred")
      .map((event) => eventPayloadId(event, "destinationProductRecordId"))
      .filter((targetId): targetId is string => targetId !== null),
  );
}

function isPendingSharedInstallationTransfer(
  installation: ProductRecord,
  source: ProductRecord,
): boolean {
  return (
    installation.visibility === "private" &&
    isActiveSharedInstallationForSource(installation, source)
  );
}

function isPotentialProductTransferTarget(
  candidate: ProductRecord,
  source: ProductRecord,
): boolean {
  return (
    candidate.productId === source.productId &&
    candidate.organizationId !== source.organizationId &&
    ((candidate.productRecordId ===
      publicProductTransferTargetId(source.productRecordId, candidate.organizationId) &&
      !candidate.sharedProductRef) ||
      isPendingSharedInstallationTransfer(candidate, source))
  );
}

function publicProductTransferDestinations(
  source: ProductRecord,
  organizations: readonly OrganizationRecord[],
  products: readonly ProductRecord[],
  pendingTargets: readonly ProductRecord[],
): ProductTransferDestination[] {
  const pendingDestinationOrganizationId = pendingTargets[0]?.organizationId;
  const pendingDestinationName = organizations.find(
    (organization) => organization.organizationId === pendingDestinationOrganizationId,
  )?.name;

  return organizations
    .map((organization) => {
      const organizationId = organization.organizationId;
      const destinationProducts = products.filter(
        (product) =>
          product.organizationId === organizationId && product.productId === source.productId,
      );
      const pendingTarget = pendingTargets.find(
        (target) => target.organizationId === organizationId,
      );
      const hasReusableProduct =
        destinationProducts.length === 1 &&
        (isActiveSharedInstallationForSource(destinationProducts[0], source) ||
          destinationProducts[0].productRecordId === pendingTarget?.productRecordId ||
          !destinationProducts[0].sharedProductRef ||
          !!destinationProducts[0].sharedProductRef.detachedAt);
      const replacesExistingProduct =
        destinationProducts.length === 1 &&
        ((!destinationProducts[0].sharedProductRef && !pendingTarget) ||
          !!destinationProducts[0].sharedProductRef?.detachedAt ||
          (!!pendingTarget &&
            pendingTarget.productRecordId !==
              publicProductTransferTargetId(source.productRecordId, organizationId)));

      let disabledReason: string | undefined;
      if (organizationId === source.organizationId) {
        disabledReason = "Already the publisher";
      } else if (organizationApprovalStatus(organization) !== "approved") {
        disabledReason =
          organizationApprovalStatus(organization) === "pending"
            ? "Waiting for organization approval"
            : "Organization is not approved";
      } else if (pendingTargets.length > 0 && !pendingTarget) {
        disabledReason = `Finish the transfer to ${pendingDestinationName ?? "its current destination"} first`;
      } else if (destinationProducts.length > 0 && !hasReusableProduct) {
        disabledReason = "Product ID is linked to another publisher";
      }

      return {
        organizationId,
        name: organization.name,
        disabledReason,
        transferNotice: replacesExistingProduct
          ? "Existing product details will be replaced"
          : undefined,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isPendingProductTransferTarget(
  candidate: ProductRecord,
  source: ProductRecord,
  completedTargets: ReadonlySet<string>,
): boolean {
  return (
    isPotentialProductTransferTarget(candidate, source) &&
    !completedTargets.has(candidate.productRecordId)
  );
}

function transferDestinationProductRecordId(
  source: ProductRecord,
  destinationOrganizationId: string,
  products: readonly ProductRecord[],
  completedTargets: ReadonlySet<string>,
): ProductRecordId {
  const pendingTarget = products.find(
    (candidate) =>
      candidate.organizationId === destinationOrganizationId &&
      isPendingProductTransferTarget(candidate, source, completedTargets),
  );
  if (pendingTarget) return pendingTarget.productRecordId;

  const existingInstallation = products.find(
    (candidate) =>
      candidate.organizationId === destinationOrganizationId &&
      isActiveSharedInstallationForSource(candidate, source),
  );
  const existingLocalProduct = products.find(
    (candidate) =>
      candidate.organizationId === destinationOrganizationId &&
      candidate.productId === source.productId &&
      (!candidate.sharedProductRef || !!candidate.sharedProductRef.detachedAt),
  );
  return (
    existingInstallation?.productRecordId ??
    existingLocalProduct?.productRecordId ??
    publicProductTransferTargetId(source.productRecordId, destinationOrganizationId)
  );
}

export async function listPublicProductsForAdministrator(
  actorId: SubjectId,
): Promise<AdministratorPublicProductTransferEntry[]> {
  return authMutationQueue.read(async () => {
    await requireAdministrator(actorId);
    const [productRows, organizationRows] = await Promise.all([
      listRecordsWithRecovery("product"),
      listRecordsWithRecovery("organization"),
    ]);
    const products = productRows.map((entry) => entry.record);
    const organizations = organizationRows.map((entry) => entry.record);
    const organizationsById = new Map(
      organizations.map((organization) => [organization.organizationId, organization]),
    );

    const candidateSources = products.filter(
      (product) =>
        isSharedProductSource(product) ||
        products.some((candidate) => isPotentialProductTransferTarget(candidate, product)),
    );
    const entries = await Promise.all(
      candidateSources.map(async (product) => {
        const potentialTransferTargets = products.filter((candidate) =>
          isPotentialProductTransferTarget(candidate, product),
        );
        const completedTransfers = potentialTransferTargets.length
          ? await completedProductTransferTargetsUnlocked(product.productRecordId)
          : new Set<string>();
        const pendingTransferTargets = potentialTransferTargets.filter(
          (candidate) => !completedTransfers.has(candidate.productRecordId),
        );
        if (!isSharedProductSource(product) && !pendingTransferTargets.length) return null;
        const publisher = organizationsById.get(product.organizationId);
        if (!publisher) return null;
        const adopterCount = products.filter(
          (candidate) =>
            !candidate.sharedProductRef?.detachedAt &&
            (refersToSharedProduct(candidate, product) ||
              pendingTransferTargets.some((target) => refersToSharedProduct(candidate, target))),
        ).length;
        return {
          product,
          publisherOrganizationName: publisher.name,
          adopterCount,
          destinations: publicProductTransferDestinations(
            product,
            organizations,
            products,
            pendingTransferTargets,
          ),
          pendingDestinationOrganizationId: pendingTransferTargets[0]?.organizationId,
        };
      }),
    );

    return entries
      .filter((entry) => entry !== null)
      .sort(
        (left, right) =>
          left.product.name.localeCompare(right.product.name) ||
          left.publisherOrganizationName.localeCompare(right.publisherOrganizationName),
      );
  });
}

export async function getOwnedPublicProductTransferOptions(
  actorId: SubjectId,
  sourceOrganizationId: string,
  productRecordId: string,
): Promise<OrganizationProductTransferOptions> {
  assertOpaqueId(productRecordId);
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, sourceOrganizationId, ["owner"]);
    const found = await loadRecord("product", productRecordId);
    if (
      !found ||
      found.record.organizationId !== sourceOrganizationId ||
      found.record.sharedProductRef ||
      found.record.archivedAt ||
      found.record.deletionStartedAt ||
      found.record.deletedAt
    ) {
      return { destinations: [] };
    }

    const [products, memberships] = await Promise.all([
      listProductsByProductIdDuringRender(found.record.productId),
      store().listMembershipsForSubject(actorId),
    ]);
    const ownedOrganizationIds = new Set(
      memberships
        .filter(
          (membership) =>
            !membership.productId && membership.role === "owner" && membership.status === "active",
        )
        .map((membership) => membership.organizationId),
    );
    const ownedOrganizations = (
      await Promise.all(
        [...ownedOrganizationIds]
          .filter((organizationId) => organizationId !== sourceOrganizationId)
          .map(async (organizationId) => {
            const organization = await loadRecord("organization", organizationId);
            return organization?.record ?? null;
          }),
      )
    ).filter((organization): organization is OrganizationRecord => organization !== null);
    const potentialTransferTargets = products.filter((candidate) =>
      isPotentialProductTransferTarget(candidate, found.record),
    );
    const completedTargets = potentialTransferTargets.length
      ? await completedProductTransferTargetsUnlocked(found.record.productRecordId)
      : new Set<string>();
    const pendingTransferTargets = potentialTransferTargets.filter(
      (candidate) => !completedTargets.has(candidate.productRecordId),
    );
    if (!isSharedProductSource(found.record) && !pendingTransferTargets.length) {
      return { destinations: [] };
    }

    const destinations = publicProductTransferDestinations(
      found.record,
      ownedOrganizations,
      products,
      pendingTransferTargets,
    );

    return {
      destinations,
      pendingDestinationOrganizationId: pendingTransferTargets.find((target) =>
        ownedOrganizationIds.has(target.organizationId),
      )?.organizationId,
    };
  });
}

function productMoveEventId(
  move: PendingProductMove,
  productRecordId: ProductRecordId,
  eventType: string,
): EventId {
  return deterministicUuidFromSeed(
    `perminister:product-move-event:v1:${productRecordId}:${move.sourceOrganizationId}:${move.destinationOrganizationId}:${move.initiatedAt}:${eventType}`,
  ) as EventId;
}

async function appendProductMoveActivity(
  move: PendingProductMove,
  product: ProductRecord,
): Promise<void> {
  const entries: Array<{ organizationId: string; type: string }> = [
    { organizationId: move.sourceOrganizationId, type: "product.moved-from" },
    { organizationId: move.destinationOrganizationId, type: "product.moved" },
  ];
  for (const entry of entries) {
    const event: AuthEvent = {
      schemaVersion: 1,
      eventId: productMoveEventId(move, product.productRecordId, entry.type),
      aggregate: { kind: "product", id: product.productRecordId },
      aggregateVersion: 1,
      occurredAt: move.initiatedAt,
      actor: { kind: "subject", subjectId: move.initiatedBySubjectId },
      type: entry.type,
      payload: {
        organizationId: entry.organizationId,
        productId: product.productId,
        productName: product.name,
        sourceOrganizationId: move.sourceOrganizationId,
        destinationOrganizationId: move.destinationOrganizationId,
      },
    };
    await store().appendEvent(event);
  }
}

export async function getOwnedProductMoveOptions(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
): Promise<OrganizationProductMoveOptions> {
  assertOpaqueId(productRecordId);
  return authMutationQueue.read(async () => {
    const found = await loadRecord("product", productRecordId);
    if (!found || found.record.sharedProductRef || found.record.deletedAt) {
      return { sourceOrganizationId: organizationId, destinations: [] };
    }

    const product = found.record;
    const pendingMove = product.pendingMove;
    const sourceOrganizationId = pendingMove?.sourceOrganizationId ?? product.organizationId;
    if (
      organizationId !== product.organizationId &&
      organizationId !== sourceOrganizationId
    ) {
      return { sourceOrganizationId, destinations: [] };
    }

    if (pendingMove) {
      await requireProductMoveOwner(actorId, sourceOrganizationId, true);
      await requireProductMoveOwner(actorId, pendingMove.destinationOrganizationId, true);
      const destination = await loadRecord("organization", pendingMove.destinationOrganizationId);
      return {
        sourceOrganizationId,
        pendingDestinationOrganizationId: pendingMove.destinationOrganizationId,
        destinations: destination
          ? [
              {
                organizationId: pendingMove.destinationOrganizationId,
                name: destination.record.name,
              },
            ]
          : [],
      };
    }

    await requireOrganizationRoleUnlocked(actorId, sourceOrganizationId, ["owner"]);

    if (
      product.organizationId !== organizationId ||
      product.visibility === "public" ||
      product.archivedAt ||
      product.deletionStartedAt
    ) {
      return { sourceOrganizationId, destinations: [] };
    }

    const ownedOrganizationIds = new Set(
      (await store().listMembershipsForSubject(actorId))
        .filter(
          (membership) =>
            !membership.productId && membership.role === "owner" && membership.status === "active",
        )
        .map((membership) => membership.organizationId),
    );
    const products = (await listRecordsWithRecovery("product")).map((entry) => entry.record);
    const destinations = await Promise.all(
      [...ownedOrganizationIds]
        .filter((destinationId) => destinationId !== sourceOrganizationId)
        .map(async (destinationId) => {
          const organization = await loadRecord("organization", destinationId);
          if (!organization) return null;
          const status = organizationApprovalStatus(organization.record);
          const hasProductConflict = products.some(
            (candidate) =>
              candidate.organizationId === destinationId &&
              candidate.productId === product.productId,
          );
          return {
            organizationId: destinationId,
            name: organization.record.name,
            disabledReason:
              status === "approved"
                ? hasProductConflict
                  ? "A product with this ID already exists in the destination organization."
                  : undefined
                : status === "pending"
                  ? "Waiting for organization approval"
                  : "Organization is not approved",
          } satisfies ProductTransferDestination;
        }),
    );
    const availableDestinations: ProductTransferDestination[] = [];
    for (const destination of destinations) {
      if (destination) availableDestinations.push(destination);
    }
    return {
      sourceOrganizationId,
      destinations: availableDestinations.sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    };
  });
}

async function movePrivateProductDataUnlocked(
  sourceOrganizationId: string,
  destinationOrganizationId: string,
  productId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const productMemberships = await store().listOrganizationMemberships(
    sourceOrganizationId,
    productId,
  );
  for (const membership of productMemberships) {
    const next: OrganizationMembershipRecord = {
      ...membership,
      organizationId: destinationOrganizationId as OrganizationId,
      permissionGrants: (membership.permissionGrants ?? []).map((grant) => ({
        ...grant,
        scope: { ...grant.scope, organizationId: destinationOrganizationId as OrganizationId },
      })),
      updatedAt: now,
    };
    await store().moveRecord(membership, next);
  }

  const productInvitations = (await listRecordsWithRecovery("organization-invitation"))
    .map((entry) => entry.record)
    .filter(
      (invitation) =>
        invitation.organizationId === sourceOrganizationId && invitation.productId === productId,
    );
  for (const invitation of productInvitations) {
    await store().moveRecord(invitation, {
      ...invitation,
      organizationId: destinationOrganizationId as OrganizationId,
    });
  }

  const principals = (await listRecordsWithRecovery("service-principal"))
    .map((entry) => entry.record)
    .filter(
      (principal) =>
        principal.organizationId === sourceOrganizationId && principal.productId === productId,
    );
  for (const principal of principals) {
    await store().writeRecord({
      ...principal,
      organizationId: destinationOrganizationId as OrganizationId,
      updatedAt: now,
    });
  }

  const productKeys = (await listRecordsWithRecovery("api-key"))
    .map((entry) => entry.record)
    .filter(
      (key) =>
        key.scope.organizationId === sourceOrganizationId && key.scope.productId === productId,
    );
  for (const key of productKeys) {
    await store().writeRecord({
      ...key,
      scope: { ...key.scope, organizationId: destinationOrganizationId as OrganizationId },
    });
  }

  const clients = (await listRecordsWithRecovery("consumer-client"))
    .map((entry) => entry.record)
    .filter(
      (client) =>
        client.organizationId === sourceOrganizationId && client.productId === productId,
    );
  for (const client of clients) {
    await store().writeRecord({
      ...client,
      organizationId: destinationOrganizationId as OrganizationId,
      updatedAt: now,
    });
  }
  invalidateOrganizationDashboardDataCache();
}

export async function getProductMoveRecoveryState(
  actorId: SubjectId,
  productRecordId: string,
): Promise<ProductMoveRecoveryState | null> {
  assertOpaqueId(productRecordId);
  return authMutationQueue.read(async () => {
    const current = await loadRecord("product", productRecordId);
    if (!current) return null;
    try {
      if (current.record.pendingMove) {
        await requireProductMoveOwner(
          actorId,
          current.record.pendingMove.sourceOrganizationId,
          true,
        );
        await requireProductMoveOwner(
          actorId,
          current.record.pendingMove.destinationOrganizationId,
          true,
        );
      } else {
        await requireOrganizationRoleUnlocked(actorId, current.record.organizationId, ["owner"]);
      }
    } catch {
      return null;
    }
    return current
      ? {
          organizationId: current.record.organizationId,
          pending: !!current.record.pendingMove,
          productId: current.record.productId,
        }
      : null;
  });
}

export async function movePrivateProductForOrganizationOwner(
  actorId: SubjectId,
  sourceOrganizationId: string,
  productRecordId: string,
  destinationOrganizationId: string,
): Promise<PrivateProductMoveResult> {
  assertOpaqueId(sourceOrganizationId);
  assertOpaqueId(productRecordId);
  assertOpaqueId(destinationOrganizationId);
  if (sourceOrganizationId === destinationOrganizationId) {
    throw new Error("Choose a different destination organization.");
  }

  return authMutationQueue.run(async () => {
    const initial = await loadRecord("product", productRecordId);
    if (!initial || initial.record.sharedProductRef || initial.record.deletedAt) {
      throw new Error("Product not found.");
    }
    const isResuming = Boolean(initial.record.pendingMove);
    await requireProductMoveOwner(actorId, sourceOrganizationId, isResuming);
    await requireProductMoveOwner(actorId, destinationOrganizationId, isResuming);
    return withOrganizationMutationLocks(
      [sourceOrganizationId, destinationOrganizationId],
      async () => {
        const current = await loadRecord("product", productRecordId);
        if (!current || current.record.sharedProductRef || current.record.deletedAt) {
          throw new Error("Product not found.");
        }

        const currentIsResuming = Boolean(current.record.pendingMove);
        await requireProductMoveOwner(actorId, sourceOrganizationId, currentIsResuming);
        await requireProductMoveOwner(actorId, destinationOrganizationId, currentIsResuming);

        let product = current.record;
        let pendingMove = product.pendingMove;
        if (pendingMove) {
          if (
            pendingMove.sourceOrganizationId !== sourceOrganizationId ||
            pendingMove.destinationOrganizationId !== destinationOrganizationId ||
            (product.organizationId !== sourceOrganizationId &&
              product.organizationId !== destinationOrganizationId)
          ) {
            throw new Error("Resume the product move to its existing destination.");
          }
        } else {
          if (
            product.organizationId !== sourceOrganizationId ||
            product.visibility === "public" ||
            product.archivedAt ||
            product.deletionStartedAt
          ) {
            throw new Error("Only an active private product can be moved directly.");
          }
          const products = (await listRecordsWithRecovery("product")).map((entry) => entry.record);
          if (
            products.some(
              (candidate) =>
                candidate.organizationId === destinationOrganizationId &&
                candidate.productId === product.productId,
            )
          ) {
            throw new Error("A product with this ID already exists in the destination organization.");
          }
          if (
            products.some((candidate) => isActiveSharedInstallationForSource(candidate, product))
          ) {
            throw new Error("Remove shared product installations before moving this product.");
          }
          const [destinationMemberships, allInvitations, allPrincipals, allKeys, allClients] =
            await Promise.all([
              store().listOrganizationMemberships(destinationOrganizationId, product.productId),
              listRecordsWithRecovery("organization-invitation"),
              listRecordsWithRecovery("service-principal"),
              listRecordsWithRecovery("api-key"),
              listRecordsWithRecovery("consumer-client"),
            ]);
          const hasDestinationProductData =
            destinationMemberships.length > 0 ||
            allInvitations.some(
              ({ record }) =>
                record.organizationId === destinationOrganizationId &&
                record.productId === product.productId,
            ) ||
            allPrincipals.some(
              ({ record }) =>
                record.organizationId === destinationOrganizationId &&
                record.productId === product.productId,
            ) ||
            allKeys.some(
              ({ record }) =>
                record.scope.organizationId === destinationOrganizationId &&
                record.scope.productId === product.productId,
            ) ||
            allClients.some(
              ({ record }) =>
                record.organizationId === destinationOrganizationId &&
                record.productId === product.productId,
            );
          if (hasDestinationProductData) {
            throw new Error("The destination already has data for this product ID.");
          }
          const organization = await loadApprovedOrganizationUnlocked(destinationOrganizationId);
          if (!organization) throw new Error("Choose an approved destination organization.");
          pendingMove = {
            sourceOrganizationId: sourceOrganizationId as OrganizationId,
            destinationOrganizationId: destinationOrganizationId as OrganizationId,
            initiatedBySubjectId: actorId,
            initiatedAt: new Date().toISOString(),
          };
          product = { ...product, pendingMove, updatedAt: new Date().toISOString() };
          await store().writeRecord(product);
          invalidateOrganizationDashboardDataCache();
        }

        if (!pendingMove) throw new Error("Product move state is missing.");
        try {
          await movePrivateProductDataUnlocked(
            sourceOrganizationId,
            destinationOrganizationId,
            product.productId,
          );
          const currentProduct = await loadRecord("product", productRecordId);
          if (!currentProduct?.record.pendingMove) {
            throw new Error("The product move could not be resumed safely.");
          }
          const destinationProduct: ProductRecord = {
            ...currentProduct.record,
            organizationId: destinationOrganizationId as OrganizationId,
            visibility: "private",
            updatedAt: new Date().toISOString(),
          };
          const sourceProductKeyRecord: ProductRecord = {
            ...destinationProduct,
            organizationId: sourceOrganizationId as OrganizationId,
          };
          await store().moveRecord(sourceProductKeyRecord, destinationProduct);
          await appendProductMoveActivity(pendingMove, destinationProduct);
          const completedProduct: ProductRecord = {
            ...destinationProduct,
            pendingMove: undefined,
            updatedAt: new Date().toISOString(),
          };
          await store().writeRecord(completedProduct);
          invalidateOrganizationDashboardDataCache();
          return {
            product: completedProduct,
            sourceOrganizationId,
            destinationOrganizationId,
            affectedOrganizationIds: [sourceOrganizationId, destinationOrganizationId],
          };
        } catch (error) {
          invalidateOrganizationDashboardDataCache();
          throw error;
        }
      },
    );
  });
}

async function requirePublicProductTransferAuthority(
  actorId: SubjectId,
  sourceOrganizationId: string,
  destinationOrganizationId: string,
  authority: PublicProductTransferAuthority,
): Promise<void> {
  if (authority === "administrator") {
    await requireAdministrator(actorId);
    return;
  }
  await requireOrganizationRoleUnlocked(actorId, sourceOrganizationId, ["owner"]);
  await requireOrganizationRoleUnlocked(actorId, destinationOrganizationId, ["owner"]);
}

async function transferPublicProduct(
  actorId: SubjectId,
  productRecordId: string,
  destinationOrganizationId: string,
  authority: PublicProductTransferAuthority,
  sourceOrganizationId?: string,
): Promise<PublicProductTransferResult> {
  assertOpaqueId(productRecordId);
  assertOpaqueId(destinationOrganizationId);
  return authMutationQueue.run(async () => {
    if (authority === "administrator") {
      await requireAdministrator(actorId);
    } else {
      if (!sourceOrganizationId) throw new Error("Organization not found.");
      await requireOrganizationRoleUnlocked(actorId, sourceOrganizationId, ["owner"]);
    }
    const initial = await loadRecord("product", productRecordId);
    if (
      !initial ||
      initial.record.sharedProductRef ||
      initial.record.archivedAt ||
      initial.record.deletionStartedAt ||
      initial.record.deletedAt ||
      (sourceOrganizationId && initial.record.organizationId !== sourceOrganizationId)
    ) {
      throw new Error("Only a public publisher product can be transferred.");
    }
    const initialSource = initial.record;
    await requirePublicProductTransferAuthority(
      actorId,
      initialSource.organizationId,
      destinationOrganizationId,
      authority,
    );
    const initialProducts = (await listRecordsWithRecovery("product")).map((entry) => entry.record);
    const initialCompletedTargets = await completedProductTransferTargetsUnlocked(
      initialSource.productRecordId,
    );
    const initialDestinationProductRecordId = transferDestinationProductRecordId(
      initialSource,
      destinationOrganizationId,
      initialProducts,
      initialCompletedTargets,
    );
    const initialPendingTargets = initialProducts.filter((product) =>
      isPendingProductTransferTarget(product, initialSource, initialCompletedTargets),
    );
    const canResumeInitialTransfer = initialPendingTargets.some(
      (product) => product.organizationId === destinationOrganizationId,
    );
    if (!isSharedProductSource(initialSource) && !canResumeInitialTransfer) {
      throw new Error("Only a public publisher product can be transferred.");
    }
    const initialDestinationProduct: ProductRecord = {
      ...initialSource,
      productRecordId: initialDestinationProductRecordId,
      organizationId: destinationOrganizationId as OrganizationId,
      visibility: "public",
    };
    const initialInstallations = initialProducts.filter(
      (product) =>
        !product.sharedProductRef?.detachedAt &&
        (refersToSharedProduct(product, initialSource) ||
          refersToSharedProduct(product, initialDestinationProduct)),
    );
    const lockIds = [
      initialSource.organizationId,
      destinationOrganizationId,
      ...initialInstallations.map((installation) => installation.organizationId),
    ];

    return withOrganizationMutationLocks(lockIds, async () => {
      const sourceRecord = await loadRecord("product", productRecordId);
      if (!sourceRecord || sourceRecord.record.sharedProductRef) {
        throw new Error("Only a public publisher product can be transferred.");
      }
      const source = sourceRecord.record;
      if (source.archivedAt || source.deletionStartedAt || source.deletedAt) {
        throw new Error("Only an active public publisher product can be transferred.");
      }
      if (sourceOrganizationId && source.organizationId !== sourceOrganizationId) {
        throw new Error("Only a public publisher product can be transferred.");
      }
      await requirePublicProductTransferAuthority(
        actorId,
        source.organizationId,
        destinationOrganizationId,
        authority,
      );
      if (destinationOrganizationId === source.organizationId) {
        throw new Error("Choose a different destination organization.");
      }
      if (!(await loadApprovedOrganizationUnlocked(destinationOrganizationId))) {
        throw new Error("Choose an approved destination organization.");
      }

      const products = (await listRecordsWithRecovery("product")).map((entry) => entry.record);
      const completedTargets = await completedProductTransferTargetsUnlocked(
        source.productRecordId,
      );
      const pendingTargets = products.filter((product) =>
        isPendingProductTransferTarget(product, source, completedTargets),
      );
      if (pendingTargets.some((product) => product.organizationId !== destinationOrganizationId)) {
        throw new Error(
          "This product has an incomplete transfer. Resume it at its existing destination first.",
        );
      }

      const destinationProductRecordId = transferDestinationProductRecordId(
        source,
        destinationOrganizationId,
        products,
        completedTargets,
      );
      const destinationRecord = await loadRecord("product", destinationProductRecordId);
      if (
        destinationRecord &&
        (destinationRecord.record.organizationId !== destinationOrganizationId ||
          destinationRecord.record.productId !== source.productId ||
          (destinationRecord.record.sharedProductRef &&
            !destinationRecord.record.sharedProductRef.detachedAt &&
            !isActiveSharedInstallationForSource(destinationRecord.record, source)))
      ) {
        throw new Error("The previous transfer cannot be resumed safely.");
      }
      const pendingAtDestination = pendingTargets.some(
        (product) => product.productRecordId === destinationProductRecordId,
      );
      if (!isSharedProductSource(source) && !pendingAtDestination) {
        throw new Error("Only a public publisher product can be transferred.");
      }

      const destinationConflicts = products.filter(
        (product) =>
          product.organizationId === destinationOrganizationId &&
          product.productId === source.productId,
      );
      const destinationHasAdopterInstallation =
        destinationConflicts.length === 1 &&
        destinationConflicts[0].productRecordId === destinationProductRecordId &&
        isActiveSharedInstallationForSource(destinationConflicts[0], source);
      const destinationHasReusableProduct =
        destinationConflicts.length === 1 &&
        destinationConflicts[0].productRecordId === destinationProductRecordId &&
        (!destinationConflicts[0].sharedProductRef ||
          !!destinationConflicts[0].sharedProductRef.detachedAt ||
          destinationHasAdopterInstallation);
      if (
        destinationConflicts.length > 1 ||
        destinationConflicts.some(
          (product) => product.productRecordId !== destinationProductRecordId,
        ) ||
        (destinationConflicts.length > 0 && !pendingAtDestination && !destinationHasReusableProduct)
      ) {
        throw new Error("The destination already has a product with this product ID.");
      }

      const destinationProduct: ProductRecord = {
        ...source,
        productRecordId: destinationProductRecordId,
        organizationId: destinationOrganizationId as OrganizationId,
        visibility: "public",
        updatedAt: new Date().toISOString(),
      };
      const destinationAdopterInstallation = destinationHasAdopterInstallation
        ? destinationConflicts[0]
        : undefined;
      const pendingDestinationProduct: ProductRecord = {
        ...destinationProduct,
        visibility: "private",
        sharedProductRef: {
          sourceOrganizationId: source.organizationId,
          sourceProductRecordId: source.productRecordId,
          sourceProductId: source.productId,
          detachedAt: null,
        },
      };
      const installations = products.filter(
        (installation) =>
          !installation.sharedProductRef?.detachedAt &&
          (refersToSharedProduct(installation, source) ||
            refersToSharedProduct(installation, destinationProduct)),
      );
      const sourcePrivateProduct: ProductRecord = {
        ...source,
        visibility: "private",
        updatedAt: new Date().toISOString(),
      };

      await store().writeRecord(pendingDestinationProduct);
      invalidateOrganizationDashboardDataCache();

      for (const installation of installations) {
        const reference = installation.sharedProductRef;
        if (
          !reference ||
          !refersToSharedProduct(installation, source) ||
          (destinationAdopterInstallation &&
            installation.productRecordId === destinationProductRecordId &&
            installation.organizationId === destinationOrganizationId)
        ) {
          continue;
        }
        await persistRecord(
          {
            ...installation,
            sharedProductRef: {
              ...reference,
              sourceOrganizationId: destinationOrganizationId as OrganizationId,
              sourceProductRecordId: destinationProductRecordId,
              sourceProductId: source.productId,
            },
            updatedAt: new Date().toISOString(),
          },
          "product.shared-installation-repointed",
          { kind: "subject", subjectId: actorId },
        );
      }

      await persistRecord(
        sourcePrivateProduct,
        "product.transferred-from",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          destinationOrganizationId,
          destinationProductRecordId,
          productName: source.name,
        },
      );
      const sourceClients = (await listRecordsWithRecovery("consumer-client"))
        .map((entry) => entry.record)
        .filter(
          (client) =>
            client.organizationId === source.organizationId &&
            client.productId === source.productId,
        );
      for (const client of sourceClients) {
        await persistRecord(
          {
            ...client,
            organizationId: destinationOrganizationId as OrganizationId,
            updatedAt: new Date().toISOString(),
          },
          "consumer-client.publisher-transferred",
          { kind: "subject", subjectId: actorId },
          {
            sourceOrganizationId: source.organizationId,
            destinationOrganizationId,
            productId: source.productId,
          },
        );
      }
      await store().writeRecord(destinationProduct);
      invalidateOrganizationDashboardDataCache();
      await appendRecordActivityEvent(
        sourcePrivateProduct,
        "product.transferred",
        { kind: "subject", subjectId: actorId },
        {
          organizationId: destinationOrganizationId,
          sourceOrganizationId: source.organizationId,
          destinationOrganizationId,
          destinationProductRecordId,
          productName: source.name,
        },
      );

      return {
        product: destinationProduct,
        sourceOrganizationId: source.organizationId,
        destinationOrganizationId,
        affectedOrganizationIds: [
          ...new Set([
            source.organizationId,
            destinationOrganizationId,
            ...installations.map((installation) => installation.organizationId),
          ]),
        ],
      };
    });
  });
}

export async function transferPublicProductForAdministrator(
  actorId: SubjectId,
  productRecordId: string,
  destinationOrganizationId: string,
): Promise<PublicProductTransferResult> {
  return transferPublicProduct(
    actorId,
    productRecordId,
    destinationOrganizationId,
    "administrator",
  );
}

export async function transferPublicProductForOrganizationOwner(
  actorId: SubjectId,
  sourceOrganizationId: string,
  productRecordId: string,
  destinationOrganizationId: string,
): Promise<PublicProductTransferResult> {
  return transferPublicProduct(
    actorId,
    productRecordId,
    destinationOrganizationId,
    "organization-owner",
    sourceOrganizationId,
  );
}
