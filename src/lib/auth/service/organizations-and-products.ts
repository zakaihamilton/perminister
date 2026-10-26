import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { mapWithConcurrency } from "../concurrency";
import { authMutationQueue } from "../mutation-queue";
import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  newOrganizationId,
  newOrganizationMembershipId,
  newProductRecordId,
  type MembershipRecord,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type OrganizationRecord,
  type OrganizationRole,
  type PermissionGrant,
  type ProductId,
  type ProductRecord,
  type ProductRecordId,
  type ProductVisibility,
  type ResourceScope,
  type SubjectId,
} from "../domain";
import type { ProductAccessRole } from "../access-roles";
import {
  type OrganizationDashboardData,
  type OrganizationSummary,
  type ProductDetailsInput,
  appendRecordActivityEvent,
  eventPayloadId,
  getCachedOrganizationDashboardData,
  invalidateOrganizationDashboardDataCache,
  listRecordsWithRecovery,
  loadApprovedOrganizationUnlocked,
  loadRecord,
  loadSubjectUnlocked,
  normalizeProductDetails,
  organizationApprovalStatus,
  organizationMembershipUnlocked,
  organizationName,
  persistRecord,
  requireAdministrator,
  requireOrganizationRoleUnlocked,
  requireVerifiedActiveSubject,
  setCachedOrganizationDashboardData,
  store,
  validateActions,
  validateProductId,
} from "./core";

export interface OrganizationRequestSummary {
  organization: OrganizationRecord;
  status: "pending" | "rejected";
}

export interface OrganizationReviewRequest {
  organizationId: OrganizationId;
  name: string;
  requesterEmail: string | null;
  createdAt: string;
}

export interface OrganizationMemberView {
  membership: OrganizationMembershipRecord;
  email: string | null;
  emailVerified: boolean;
}

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

const listMembershipsForSubjectDuringRender = cache((subjectId: SubjectId) =>
  store().listMembershipsForSubject(subjectId),
);
const listProductsForOrganizationDuringRender = cache((organizationId: string) =>
  store().listProducts(organizationId),
);

async function listOrganizationRequestsForSubjectUnlocked(
  subjectId: SubjectId,
): Promise<OrganizationRequestSummary[]> {
  const organizations = (await listRecordsWithRecovery("organization"))
    .map((item) => item.record)
    .filter((organization) => organization.createdBySubjectId === subjectId)
    .flatMap((organization) => {
      const status = organizationApprovalStatus(organization);
      return status === "pending" || status === "rejected" ? [{ organization, status }] : [];
    });
  return organizations.sort((left, right) =>
    right.organization.createdAt.localeCompare(left.organization.createdAt),
  );
}

export async function createOrganization(
  subjectId: SubjectId,
  nameInput: string,
): Promise<OrganizationRecord> {
  const name = organizationName(nameInput);
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    requireVerifiedActiveSubject(subject);
    const pendingRequests = await listOrganizationRequestsForSubjectUnlocked(subjectId);
    if (pendingRequests.some((request) => request.status === "pending")) {
      throw new Error("An organization request is already pending.");
    }
    const now = new Date().toISOString();
    const organization: OrganizationRecord = {
      kind: "organization",
      schemaVersion: 1,
      organizationId: newOrganizationId(),
      name,
      approvalStatus: "pending",
      createdBySubjectId: subjectId,
      createdAt: now,
      updatedAt: now,
    };
    await persistRecord(organization, "organization.requested", { kind: "subject", subjectId });
    const membership: OrganizationMembershipRecord = {
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: newOrganizationMembershipId(),
      organizationId: organization.organizationId,
      subjectId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await persistRecord(
      membership,
      "organization.member-added",
      { kind: "subject", subjectId },
      { changes: [{ field: "role", before: "None", after: membership.role }] },
    );
    return organization;
  });
}

export const listOrganizationsForSubject = cache(async function listOrganizationsForSubject(
  subjectId: SubjectId,
): Promise<OrganizationSummary[]> {
  return authMutationQueue.read(async () => {
    const memberships = (await store().listMembershipsForSubject(subjectId)).filter(
      (record) => record.status === "active",
    );
    const byOrganization = new Map<string, OrganizationMembershipRecord[]>();
    for (const membership of memberships) {
      const entries = byOrganization.get(membership.organizationId) ?? [];
      entries.push(membership);
      byOrganization.set(membership.organizationId, entries);
    }
    const summaries = await mapWithConcurrency<
      [string, OrganizationMembershipRecord[]],
      OrganizationSummary | null
    >([...byOrganization.entries()], async ([organizationId, entries]) => {
      const organization = await loadRecord("organization", organizationId);
      if (!organization || organizationApprovalStatus(organization.record) !== "approved") {
        return null;
      }
      const catalogManager = entries.find((membership) => !membership.productId);
      const productMember = entries.find((membership) => membership.productId);
      if (catalogManager) {
        return {
          organization: organization.record,
          membership: catalogManager,
          catalogManager: true,
        } satisfies OrganizationSummary;
      }
      if (productMember) {
        return {
          organization: organization.record,
          membership: {
            ...productMember,
            role: "member",
            productId: undefined,
            permissionGrants: undefined,
          },
          catalogManager: false,
        } satisfies OrganizationSummary;
      }
      return null;
    });
    return summaries
      .filter((summary): summary is OrganizationSummary => summary !== null)
      .sort((left, right) => left.organization.name.localeCompare(right.organization.name));
  });
});

export async function listOrganizationRequestsForSubject(
  subjectId: SubjectId,
): Promise<OrganizationRequestSummary[]> {
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    if (!subject || subject.status !== "active") {
      throw new Error("An active account is required.");
    }
    return listOrganizationRequestsForSubjectUnlocked(subjectId);
  });
}

async function pendingOrganizationsForAdministratorUnlocked(
  actorId: SubjectId,
): Promise<OrganizationRecord[]> {
  await requireAdministrator(actorId);
  return (await listRecordsWithRecovery("organization"))
    .map((item) => item.record)
    .filter((organization) => organizationApprovalStatus(organization) === "pending");
}

export async function countPendingOrganizationsForAdministrator(
  actorId: SubjectId,
): Promise<number> {
  return authMutationQueue.read(async () => {
    const organizations = await pendingOrganizationsForAdministratorUnlocked(actorId);
    return organizations.length;
  });
}

export async function listPendingOrganizationsForAdministrator(
  actorId: SubjectId,
): Promise<OrganizationReviewRequest[]> {
  return authMutationQueue.run(async () => {
    const organizations = (await pendingOrganizationsForAdministratorUnlocked(actorId)).sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt),
    );
    const requests: OrganizationReviewRequest[] = [];
    for (const organization of organizations) {
      const requester = await loadSubjectUnlocked(organization.createdBySubjectId);
      requests.push({
        organizationId: organization.organizationId,
        name: organization.name,
        requesterEmail: requester?.primaryEmail ?? null,
        createdAt: organization.createdAt,
      });
    }
    return requests;
  });
}

export async function decideOrganizationRequest(
  actorId: SubjectId,
  organizationId: string,
  approvalStatus: "approved" | "rejected",
): Promise<void> {
  assertOpaqueId(organizationId);
  await authMutationQueue.run(async () => {
    const actor = await requireAdministrator(actorId);
    const current = await loadRecord("organization", organizationId);
    if (!current || organizationApprovalStatus(current.record) !== "pending") {
      throw new Error("Only pending organization requests can be reviewed.");
    }
    const next: OrganizationRecord = {
      ...current.record,
      approvalStatus,
      updatedAt: new Date().toISOString(),
    };
    await persistRecord(
      next,
      approvalStatus === "approved" ? "organization.approved" : "organization.rejected",
      { kind: "subject", subjectId: actor.subjectId },
    );
  });
}

export interface ConsumerOrganizationAccess {
  organizationId: OrganizationId;
  organizationName: string;
  organizationRole: OrganizationRole;
  productId: string;
  permissions: PermissionGrant[];
  resourceRoles: Array<{
    scope: ResourceScope;
    role: string | null;
    actions: string[];
  }>;
  platformAdmin: boolean;
}

export async function listConsumerOrganizationsForSubject(
  subjectId: SubjectId,
  productId: string,
): Promise<ConsumerOrganizationAccess[]> {
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.read(async () => {
    const organizationMemberships = await store().listMembershipsForSubject(subjectId);
    const activeMemberships = new Map<string, OrganizationMembershipRecord>();
    const grantsByOrganization = new Map<string, MembershipRecord[]>();
    for (const membership of organizationMemberships) {
      for (const grant of membership.permissionGrants ?? []) {
        if (
          grant.subjectId !== subjectId ||
          grant.status !== "active" ||
          grant.scope.productId !== normalizedProductId
        ) {
          continue;
        }
        const organizationGrants = grantsByOrganization.get(grant.scope.organizationId) ?? [];
        organizationGrants.push(grant);
        grantsByOrganization.set(grant.scope.organizationId, organizationGrants);
      }
      if (
        membership.subjectId !== subjectId ||
        membership.status !== "active" ||
        (membership.productId && membership.productId !== normalizedProductId)
      ) {
        continue;
      }
      const existing = activeMemberships.get(membership.organizationId);
      if (!existing || (existing.productId && !membership.productId)) {
        activeMemberships.set(membership.organizationId, membership);
      }
    }
    const results = await mapWithConcurrency<
      OrganizationMembershipRecord,
      ConsumerOrganizationAccess | null
    >([...activeMemberships.values()], async (membership) => {
      const [productResult, organizationResult] = await Promise.allSettled([
        store().readProduct(membership.organizationId, normalizedProductId),
        loadRecord("organization", membership.organizationId),
      ]);
      if (productResult.status === "rejected") throw productResult.reason;
      if (!productResult.value) return null;
      if (organizationResult.status === "rejected") throw organizationResult.reason;
      const organization = organizationResult.value;
      if (!organization) return null;
      const scopedMemberships = grantsByOrganization.get(membership.organizationId) ?? [];
      const permissions = scopedMemberships.flatMap((grant) => grant.grants);
      return {
        organizationId: membership.organizationId,
        organizationName: organization.record.name,
        organizationRole: membership.role,
        productId: normalizedProductId,
        permissions,
        resourceRoles: scopedMemberships.map((grant) => ({
          scope: grant.scope,
          role: grant.accessRole?.name ?? null,
          actions: grant.grants.flatMap((permission) => [...permission.actions]),
        })),
        platformAdmin: scopedMemberships.some(
          (grant) => grant.scope.kind === "product" && grant.accessRole?.name === "platform-admin",
        ),
      };
    });
    return results
      .filter((result): result is ConsumerOrganizationAccess => result !== null)
      .sort((left, right) => left.organizationName.localeCompare(right.organizationName));
  });
}

export const getOrganizationForSubject = cache(async function getOrganizationForSubject(
  subjectId: SubjectId,
  organizationId: string,
): Promise<OrganizationSummary> {
  return authMutationQueue.read(async () => {
    const [catalogManager, organization] = await Promise.all([
      organizationMembershipUnlocked(organizationId, subjectId),
      loadRecord("organization", organizationId),
    ]);
    const productMembership = catalogManager
      ? null
      : ((await listMembershipsForSubjectDuringRender(subjectId)).find(
          (entry) =>
            entry.organizationId === organizationId &&
            !!entry.productId &&
            entry.status === "active",
        ) ?? null);
    if (
      (!catalogManager && !productMembership) ||
      !organization ||
      organizationApprovalStatus(organization.record) !== "approved"
    ) {
      throw new Error("Organization not found.");
    }
    const membership = catalogManager ?? {
      ...productMembership!,
      role: "member" as const,
      productId: undefined,
      permissionGrants: undefined,
    };
    return { organization: organization.record, membership, catalogManager: !!catalogManager };
  });
});

export async function updateOrganizationName(
  actorId: SubjectId,
  organizationId: string,
  nameInput: string,
): Promise<OrganizationRecord> {
  const name = organizationName(nameInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner"]);
      const current = await loadRecord("organization", organizationId);
      if (!current) throw new Error("Organization not found.");
      const next = { ...current.record, name, updatedAt: new Date().toISOString() };
      await persistRecord(next, "organization.updated", { kind: "subject", subjectId: actorId });
      return next;
    }),
  );
}

export const listOrganizationMembers = cache(async function listOrganizationMembers(
  actorId: SubjectId,
  organizationId: string,
): Promise<OrganizationMemberView[]> {
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const memberships = (await store().listOrganizationMemberships(organizationId, null))
      .filter((record) => !record.productId && record.status === "active")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return mapWithConcurrency(memberships, async (membership) => {
      const subject = await loadSubjectUnlocked(membership.subjectId);
      return {
        membership,
        email: subject?.primaryEmail ?? null,
        emailVerified: !!subject?.emailVerifiedAt,
      };
    });
  });
});

export const countOrganizationMembersForSubject = cache(
  async function countOrganizationMembersForSubject(
    actorId: SubjectId,
    organizationId: string,
  ): Promise<number> {
    return authMutationQueue.read(async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
      const memberships = await store().listOrganizationMemberships(organizationId, null);
      return memberships.filter(
        (membership) => !membership.productId && membership.status === "active",
      ).length;
    });
  },
);

async function requireOrganizationOwnerAndMemberUnlocked(
  actorId: SubjectId,
  organizationId: string,
  membershipId: string,
  requireActive: boolean,
) {
  const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner"]);
  const membership = await loadRecord("organization-membership", membershipId);
  if (
    !membership ||
    membership.record.organizationId !== organizationId ||
    !!membership.record.productId ||
    (requireActive && membership.record.status !== "active")
  ) {
    throw new Error("Organization member not found.");
  }
  return { actorMembership, membership: membership.record };
}

export async function updateOrganizationMemberRole(
  actorId: SubjectId,
  organizationId: string,
  membershipId: string,
  role: Exclude<OrganizationRole, "member">,
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const { actorMembership, membership } = await requireOrganizationOwnerAndMemberUnlocked(
        actorId,
        organizationId,
        membershipId,
        true,
      );
      if (membership.role === role) return;
      const all = (await listRecordsWithRecovery("organization-membership")).map(
        (item) => item.record,
      );
      const owners = all.filter(
        (item) =>
          item.organizationId === organizationId &&
          !item.productId &&
          item.role === "owner" &&
          item.status === "active",
      );
      if (membership.role === "owner" && role !== "owner" && owners.length <= 1) {
        throw new Error("An organization must keep at least one owner.");
      }
      const next = { ...membership, role, updatedAt: new Date().toISOString() };
      await persistRecord(
        next,
        "organization.member-role-updated",
        {
          kind: "subject",
          subjectId: actorMembership.subjectId,
        },
        {
          changes: [{ field: "role", before: membership.role, after: role }],
        },
      );
    }),
  );
}

export async function removeOrganizationMember(
  actorId: SubjectId,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const { actorMembership, membership } = await requireOrganizationOwnerAndMemberUnlocked(
        actorId,
        organizationId,
        membershipId,
        false,
      );
      if (membership.status === "active" && membership.role === "owner") {
        const owners = (await listRecordsWithRecovery("organization-membership"))
          .map((item) => item.record)
          .filter(
            (item) =>
              item.organizationId === organizationId &&
              !item.productId &&
              item.role === "owner" &&
              item.status === "active",
          );
        if (owners.length <= 1) throw new Error("An organization must keep at least one owner.");
      }
      if (membership.status === "active") {
        await persistRecord(
          { ...membership, status: "disabled", updatedAt: new Date().toISOString() },
          "organization.member-removed",
          { kind: "subject", subjectId: actorMembership.subjectId },
        );
      }
    }),
  );
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
      const products = (await listRecordsWithRecovery("product"))
        .map((item) => item.record)
        .filter(
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
      const next: ProductRecord = {
        ...current.record,
        ...details,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "product.updated", {
        kind: "subject",
        subjectId: manager.subjectId,
      });
      return next;
    }),
  );
}

export interface PublicProductCatalogEntry {
  product: ProductRecord;
  publisherOrganizationName: string;
  status: "available" | "installed" | "setup-required" | "conflict";
}

export interface ProductShareInfo {
  visibility: ProductVisibility;
  adopterOrganizations: Array<{ organizationId: string; name: string }>;
}

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

export function isSharedProductSource(product: ProductRecord): boolean {
  return !product.sharedProductRef && product.visibility === "public";
}

async function hasAnotherPublicPublisherUnlocked(product: ProductRecord): Promise<boolean> {
  return (await listRecordsWithRecovery("product")).some(
    (entry) =>
      entry.record.organizationId !== product.organizationId &&
      entry.record.productId === product.productId &&
      isSharedProductSource(entry.record),
  );
}

function publicProductTransferTargetId(
  sourceProductRecordId: ProductRecordId,
  destinationOrganizationId: string,
): ProductRecordId {
  const bytes = createHash("sha256")
    .update(
      `perminister:public-product-transfer:v1:${sourceProductRecordId}:${destinationOrganizationId}`,
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as ProductRecordId;
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

function refersToSharedProduct(installation: ProductRecord, source: ProductRecord): boolean {
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

async function withOrganizationMutationLocks<Result>(
  organizationIds: readonly string[],
  operation: () => Promise<Result>,
): Promise<Result> {
  const ordered = [...new Set(organizationIds)].sort();
  const lockAt = (index: number): Promise<Result> =>
    index >= ordered.length
      ? operation()
      : withOrganizationMutationLock(ordered[index], () => lockAt(index + 1));
  return lockAt(0);
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
      const installation: ProductRecord = {
        ...source,
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

async function sharedInstallationsForSourceUnlocked(
  source: ProductRecord,
): Promise<ProductRecord[]> {
  return (await listRecordsWithRecovery("product"))
    .map((entry) => entry.record)
    .filter((product) => product.organizationId !== source.organizationId)
    .filter((product) => refersToSharedProduct(product, source));
}

async function organizationNamesForInstallationsUnlocked(
  installations: readonly ProductRecord[],
): Promise<Array<{ organizationId: string; name: string }>> {
  const organizations = (await listRecordsWithRecovery("organization")).map(
    (entry) => entry.record,
  );
  const byId = new Map(
    organizations.map((organization) => [organization.organizationId, organization]),
  );
  return installations
    .filter((installation) => !installation.sharedProductRef?.detachedAt)
    .map((installation) => {
      const organization = byId.get(installation.organizationId);
      return {
        organizationId: installation.organizationId,
        name: organization?.name ?? "Unknown organization",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
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
    if (await hasAnotherPublicPublisherUnlocked(found.record)) return null;

    const installations = await sharedInstallationsForSourceUnlocked(found.record);
    return {
      visibility: found.record.visibility === "public" ? "public" : "private",
      adopterOrganizations: await organizationNamesForInstallationsUnlocked(installations),
    };
  });
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
      found.record.sharedProductRef
    ) {
      return { destinations: [] };
    }

    const [productRows, organizationRows, memberships] = await Promise.all([
      listRecordsWithRecovery("product"),
      listRecordsWithRecovery("organization"),
      store().listMembershipsForSubject(actorId),
    ]);
    const products = productRows.map((entry) => entry.record);
    const organizations = organizationRows.map((entry) => entry.record);
    const ownedOrganizationIds = new Set(
      memberships
        .filter(
          (membership) =>
            !membership.productId && membership.role === "owner" && membership.status === "active",
        )
        .map((membership) => membership.organizationId),
    );
    const ownedOrganizations = organizations.filter(
      (organization) =>
        ownedOrganizationIds.has(organization.organizationId) &&
        organization.organizationId !== sourceOrganizationId,
    );
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

export interface PublicProductTransferResult {
  product: ProductRecord;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  affectedOrganizationIds: string[];
}

type PublicProductTransferAuthority = "administrator" | "organization-owner";

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
  return authMutationQueue.run(async () => {
    const initial = await loadRecord("product", productRecordId);
    if (
      !initial ||
      initial.record.organizationId !== organizationId ||
      initial.record.sharedProductRef
    ) {
      throw new Error("Product not found.");
    }
    const initialInstallations = await sharedInstallationsForSourceUnlocked(initial.record);
    const lockIds = [organizationId, ...initialInstallations.map((entry) => entry.organizationId)];
    return withOrganizationMutationLocks(lockIds, async () => {
      const actor = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("product", productRecordId);
      if (
        !current ||
        current.record.organizationId !== organizationId ||
        current.record.sharedProductRef
      ) {
        throw new Error("Product not found.");
      }
      if (visibility === "public" && (await hasAnotherPublicPublisherUnlocked(current.record))) {
        throw new Error("Another organization already publishes a product with this product ID.");
      }
      const installations = await sharedInstallationsForSourceUnlocked(current.record);
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
    });
  });
}

export async function createProductAccessRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  input: { name: string; description: string; actions: readonly string[] },
): Promise<ProductAccessRole> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Enter a role name up to 80 characters.");
  }
  if (description.length > 240 || /[\u0000-\u001f\u007f]/.test(description)) {
    throw new Error("The role description must be 240 characters or fewer.");
  }
  const actions = validateActions(input.actions);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const { actor, product } = await requireManageableProductUnlocked(
        actorId,
        organizationId,
        productId,
      );
      const roles = product.accessRoles ?? [];
      if (roles.length >= 32) throw new Error("A product can have up to 32 access roles.");
      if (roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("An access role with that name already exists.");
      }
      const role: ProductAccessRole = {
        id: `role-${randomBytes(16).toString("hex")}`,
        name,
        description,
        actions,
      };
      await persistRecord(
        { ...product, accessRoles: [...roles, role], updatedAt: new Date().toISOString() },
        "product.access-role-created",
        { kind: "subject", subjectId: actor.subjectId },
      );
      return role;
    }),
  );
}

export async function removeProductAccessRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  accessRoleId: string,
): Promise<void> {
  if (!/^role-[0-9a-f]{32}$/.test(accessRoleId)) throw new Error("Choose an access role.");
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const { actor, product } = await requireManageableProductUnlocked(
        actorId,
        organizationId,
        productId,
      );
      const roles = product.accessRoles ?? [];
      const nextRoles = roles.filter((role) => role.id !== accessRoleId);
      if (nextRoles.length === roles.length) throw new Error("Access role not found.");
      await persistRecord(
        { ...product, accessRoles: nextRoles, updatedAt: new Date().toISOString() },
        "product.access-role-removed",
        { kind: "subject", subjectId: actor.subjectId },
      );
    }),
  );
}

async function requireManageableProductUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<{ actor: OrganizationMembershipRecord; product: ProductRecord }> {
  const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
    "owner",
    "admin",
  ]);
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Choose a product in this organization.");
  if (product.sharedProductRef) {
    throw new Error("Shared access roles are controlled by the publishing organization.");
  }
  return { actor, product };
}

export const listProductsForOrganization = cache(async function listProductsForOrganization(
  subjectId: SubjectId,
  organizationId: string,
): Promise<ProductRecord[]> {
  return authMutationQueue.read(async () => {
    const [organization, catalogManager] = await Promise.all([
      loadApprovedOrganizationUnlocked(organizationId),
      organizationMembershipUnlocked(organizationId, subjectId),
    ]);
    if (!organization) throw new Error("Organization not found.");
    const [memberRows, products] = await Promise.all([
      catalogManager ? Promise.resolve([]) : listMembershipsForSubjectDuringRender(subjectId),
      listProductsForOrganizationDuringRender(organizationId),
    ]);
    const allowedProducts = new Set(
      memberRows
        .filter(
          (row) =>
            row.organizationId === organizationId && row.productId && row.status === "active",
        )
        .map((row) => row.productId!),
    );
    if (!catalogManager && allowedProducts.size === 0) throw new Error("Organization not found.");
    return products
      .filter((product) => !!catalogManager || allowedProducts.has(product.productId))
      .sort((left, right) => left.name.localeCompare(right.name));
  });
});

export const getOrganizationDashboardData = cache(async function getOrganizationDashboardData(
  subjectId: SubjectId,
  organizationId: string,
): Promise<OrganizationDashboardData> {
  return authMutationQueue.read(async () => {
    assertOpaqueId(organizationId);
    const cached = getCachedOrganizationDashboardData(subjectId, organizationId);
    if (cached) {
      const [organizationRecord, catalogMembershipRecord] = await Promise.all([
        loadRecord("organization", organizationId),
        store().readOrganizationMembership(organizationId, subjectId),
      ]);
      const organization = organizationRecord?.record;
      if (!organization || organizationApprovalStatus(organization) !== "approved") {
        throw new Error("Organization not found.");
      }
      const catalogMembership =
        catalogMembershipRecord?.status === "active" ? catalogMembershipRecord : null;
      const productMembership = cached.memberships.find(
        (membership) =>
          membership.organizationId === organizationId &&
          !!membership.productId &&
          membership.status === "active",
      );
      if (!catalogMembership && !productMembership) throw new Error("Organization not found.");
      const currentMembership = catalogMembership ?? {
        ...productMembership!,
        role: "member" as const,
        productId: undefined,
        permissionGrants: undefined,
      };
      const organizationSummary = {
        organization,
        membership: currentMembership,
        catalogManager: !!catalogMembership,
      } satisfies OrganizationSummary;
      const data: OrganizationDashboardData = {
        ...cached.data,
        organization: organizationSummary,
        organizations: cached.data.organizations.map((summary) =>
          summary.organization.organizationId === organizationId ? organizationSummary : summary,
        ),
      };
      return data;
    }

    const [organizationRecord, catalogMembershipRecord, memberships, allProducts] =
      await Promise.all([
        loadRecord("organization", organizationId),
        store().readOrganizationMembership(organizationId, subjectId),
        listMembershipsForSubjectDuringRender(subjectId),
        listProductsForOrganizationDuringRender(organizationId),
      ]);
    const organization = organizationRecord?.record;
    if (!organization || organizationApprovalStatus(organization) !== "approved") {
      throw new Error("Organization not found.");
    }

    const catalogMembership =
      catalogMembershipRecord?.status === "active" ? catalogMembershipRecord : null;
    const activeMemberships = memberships.filter((membership) => membership.status === "active");
    const productMembership = activeMemberships.find(
      (membership) => membership.organizationId === organizationId && !!membership.productId,
    );
    if (!catalogMembership && !productMembership) throw new Error("Organization not found.");
    const currentMembership = catalogMembership ?? {
      ...productMembership!,
      role: "member" as const,
      productId: undefined,
      permissionGrants: undefined,
    };

    const membershipsByOrganization = new Map<string, OrganizationMembershipRecord[]>();
    for (const membership of activeMemberships) {
      const entries = membershipsByOrganization.get(membership.organizationId) ?? [];
      entries.push(membership);
      membershipsByOrganization.set(membership.organizationId, entries);
    }
    const organizationSummaries = await mapWithConcurrency<
      [string, OrganizationMembershipRecord[]],
      OrganizationSummary | null
    >([...membershipsByOrganization.entries()], async ([memberOrganizationId, entries]) => {
      const record =
        memberOrganizationId === organizationId
          ? organizationRecord
          : await loadRecord("organization", memberOrganizationId);
      if (!record || organizationApprovalStatus(record.record) !== "approved") return null;
      const organizationCatalogMembership = entries.find((membership) => !membership.productId);
      const organizationProductMembership = entries.find((membership) => !!membership.productId);
      if (organizationCatalogMembership) {
        return {
          organization: record.record,
          membership: organizationCatalogMembership,
          catalogManager: true,
        } satisfies OrganizationSummary;
      }
      if (!organizationProductMembership) return null;
      return {
        organization: record.record,
        membership: {
          ...organizationProductMembership,
          role: "member",
          productId: undefined,
          permissionGrants: undefined,
        },
        catalogManager: false,
      } satisfies OrganizationSummary;
    });

    const allowedProductIds = new Set(
      activeMemberships
        .filter(
          (membership) => membership.organizationId === organizationId && membership.productId,
        )
        .map((membership) => membership.productId!),
    );
    if (!catalogMembership && allowedProductIds.size === 0) {
      throw new Error("Organization not found.");
    }
    const data: OrganizationDashboardData = {
      organization: {
        organization,
        membership: currentMembership,
        catalogManager: !!catalogMembership,
      },
      organizations: organizationSummaries
        .filter((summary): summary is OrganizationSummary => summary !== null)
        .sort((left, right) => left.organization.name.localeCompare(right.organization.name)),
      products: allProducts
        .filter((product) => !!catalogMembership || allowedProductIds.has(product.productId))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
    setCachedOrganizationDashboardData(subjectId, organizationId, data, memberships);
    return data;
  });
});

export async function getProductForOrganization(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  return authMutationQueue.run(async () => {
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
  const organization = await loadApprovedOrganizationUnlocked(organizationId);
  if (!organization) throw new Error("Organization not found.");
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
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
  return authMutationQueue.run(() =>
    getProductAccessUnlocked(subjectId, organizationId, productId),
  );
}

export async function requireProductRoleUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  roles: readonly OrganizationRole[],
): Promise<OrganizationMembershipRecord> {
  assertOpaqueId(organizationId);
  const [actor, organization, product, membership] = await Promise.all([
    loadSubjectUnlocked(actorId),
    loadApprovedOrganizationUnlocked(organizationId),
    store().readProduct(organizationId, productId),
    store().readOrganizationMembership(organizationId, actorId, productId),
  ]);
  requireVerifiedActiveSubject(actor);
  if (!organization || !product) throw new Error("Product not found.");
  if (!membership || membership.status !== "active" || !roles.includes(membership.role)) {
    throw new Error("You do not have permission to manage this product.");
  }
  return membership;
}
