import "server-only";

import { cache } from "react";
import { mapWithConcurrency } from "../concurrency";
import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  type MembershipRecord,
  newOrganizationId,
  newOrganizationMembershipId,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type OrganizationRecord,
  type OrganizationRole,
  type PermissionGrant,
  type ResourceScope,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { withRequestPerformanceSpan } from "../performance";
import {
  getCachedOrganizationDashboardData,
  type OrganizationDashboardData,
  type OrganizationSummary,
  setCachedOrganizationDashboardData,
} from "./dashboard-cache";
import {
  listMembershipsForSubjectDuringRender,
  listProductsForOrganizationDuringRender,
  listRecordsWithRecovery,
  loadApprovedOrganizationUnlocked,
  loadRecord,
  loadSubjectUnlocked,
  mapMembershipsToSubjectContact,
  organizationMembershipUnlocked,
  persistRecord,
  requireAdministrator,
  requireOrganizationRoleUnlocked,
  store,
} from "./persistence";
import {
  organizationApprovalStatus,
  organizationName,
  requireVerifiedActiveSubject,
  validateProductId,
} from "./validators";

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

export interface ConsumerOrganizationAccess {
  organizationId: OrganizationId;
  organizationName: string;
  /** Present for the selected organization; omitted on lightweight switcher entries. */
  organizationRole?: OrganizationRole;
  productId: string;
  permissions: PermissionGrant[];
  resourceRoles: Array<{
    scope: ResourceScope;
    role: string | null;
    actions: string[];
  }>;
  platformAdmin: boolean;
}

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

function organizationSummaryFromMemberships(
  organization: OrganizationRecord,
  memberships: readonly OrganizationMembershipRecord[],
): OrganizationSummary | null {
  const catalogManager = memberships.find((membership) => !membership.productId);
  if (catalogManager) {
    return { organization, membership: catalogManager, catalogManager: true };
  }
  const productMember = memberships.find((membership) => !!membership.productId);
  if (!productMember) return null;
  return {
    organization,
    membership: {
      ...productMember,
      role: "member",
      productId: undefined,
      permissionGrants: undefined,
    },
    catalogManager: false,
  };
}

function groupActiveMembershipsByOrganization(
  memberships: readonly OrganizationMembershipRecord[],
): Map<string, OrganizationMembershipRecord[]> {
  const byOrganization = new Map<string, OrganizationMembershipRecord[]>();
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const entries = byOrganization.get(membership.organizationId) ?? [];
    entries.push(membership);
    byOrganization.set(membership.organizationId, entries);
  }
  return byOrganization;
}

function sortOrganizationSummaries(
  summaries: (OrganizationSummary | null)[],
): OrganizationSummary[] {
  return summaries
    .filter((summary): summary is OrganizationSummary => summary !== null)
    .sort((left, right) => left.organization.name.localeCompare(right.organization.name));
}

async function loadOrganizationSummaries(
  byOrganization: Map<string, OrganizationMembershipRecord[]>,
  preferredOrganization?: OrganizationSummary,
): Promise<OrganizationSummary[]> {
  const summaries = await mapWithConcurrency<
    [string, OrganizationMembershipRecord[]],
    OrganizationSummary | null
  >([...byOrganization.entries()], async ([organizationId, memberships]) => {
    if (preferredOrganization?.organization.organizationId === organizationId) {
      return preferredOrganization;
    }
    const organization = await withRequestPerformanceSpan("dashboard.organization-summaries", () =>
      loadRecord("organization", organizationId),
    );
    if (!organization || organizationApprovalStatus(organization.record) !== "approved") {
      return null;
    }
    return organizationSummaryFromMemberships(organization.record, memberships);
  });
  return sortOrganizationSummaries(summaries);
}

export const listOrganizationsForSubject = cache(async function listOrganizationsForSubject(
  subjectId: SubjectId,
): Promise<OrganizationSummary[]> {
  return authMutationQueue.read(async () => {
    const memberships = await listMembershipsForSubjectDuringRender(subjectId);
    return loadOrganizationSummaries(groupActiveMembershipsByOrganization(memberships));
  });
});

export const listOrganizationSwitcherData = cache(async function listOrganizationSwitcherData(
  subjectId: SubjectId,
  currentOrganizationId: string,
): Promise<OrganizationSummary[]> {
  assertOpaqueId(currentOrganizationId);
  return authMutationQueue.read(async () => {
    const [memberships, currentOrganization] = await Promise.all([
      listMembershipsForSubjectDuringRender(subjectId),
      withRequestPerformanceSpan("dashboard.selected-organization", () =>
        getOrganizationForSubject(subjectId, currentOrganizationId),
      ),
    ]);
    const byOrganization = groupActiveMembershipsByOrganization(memberships);
    if (!byOrganization.has(currentOrganizationId)) {
      byOrganization.set(currentOrganizationId, [currentOrganization.membership]);
    }
    return loadOrganizationSummaries(byOrganization, currentOrganization);
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

export async function listConsumerOrganizationsForSubject(
  subjectId: SubjectId,
  productId: string,
  selectedOrganizationId?: string,
): Promise<ConsumerOrganizationAccess[]> {
  const normalizedProductId = validateProductId(productId);
  const selectedId = selectedOrganizationId?.toLowerCase();
  if (selectedId) assertOpaqueId(selectedId);
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
      const detailedAccess =
        !selectedId ||
        !activeMemberships.has(selectedId) ||
        membership.organizationId === selectedId;
      const [productResult, organizationResult] = await Promise.allSettled([
        detailedAccess
          ? store().readProduct(membership.organizationId, normalizedProductId)
          : Promise.resolve(null),
        loadRecord("organization", membership.organizationId),
      ]);
      if (productResult.status === "rejected") throw productResult.reason;
      if (detailedAccess && !productResult.value) return null;
      if (organizationResult.status === "rejected") throw organizationResult.reason;
      const organization = organizationResult.value;
      if (!organization) return null;
      const scopedMemberships = detailedAccess
        ? (grantsByOrganization.get(membership.organizationId) ?? [])
        : [];
      const permissions = scopedMemberships.flatMap((grant) => grant.grants);
      return {
        organizationId: membership.organizationId,
        organizationName: organization.record.name,
        ...(detailedAccess ? { organizationRole: membership.role } : {}),
        productId: normalizedProductId,
        permissions,
        resourceRoles: scopedMemberships.map((grant) => ({
          scope: grant.scope,
          role: grant.accessRole?.role ?? grant.accessRole?.name ?? null,
          actions: grant.grants.flatMap((permission) => [...permission.actions]),
        })),
        platformAdmin:
          detailedAccess &&
          scopedMemberships.some(
            (grant) =>
              grant.scope.kind === "product" && grant.accessRole?.name === "platform-admin",
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
      withRequestPerformanceSpan("dashboard.selected-membership", () =>
        organizationMembershipUnlocked(organizationId, subjectId),
      ),
      withRequestPerformanceSpan("dashboard.selected-organization", () =>
        loadRecord("organization", organizationId),
      ),
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
    return mapMembershipsToSubjectContact(memberships);
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

export const getOrganizationDashboardData = cache(async function getOrganizationDashboardData(
  subjectId: SubjectId,
  organizationId: string,
): Promise<OrganizationDashboardData> {
  return authMutationQueue.read(async () => {
    assertOpaqueId(organizationId);
    const cached = getCachedOrganizationDashboardData(subjectId, organizationId);
    if (cached) {
      const [organizationRecord, membership] = await Promise.all([
        withRequestPerformanceSpan("dashboard.selected-organization", () =>
          loadRecord("organization", organizationId),
        ),
        withRequestPerformanceSpan("dashboard.membership-validation", () =>
          store().readOrganizationMembership(
            organizationId,
            subjectId,
            cached.membership.productId,
          ),
        ),
      ]);
      const organization = organizationRecord?.record;
      const activeMembership = membership?.status === "active" ? membership : null;
      if (
        !organization ||
        organizationApprovalStatus(organization) !== "approved" ||
        !activeMembership
      ) {
        throw new Error("Organization not found.");
      }
      const currentMembership = cached.membership.productId
        ? {
            ...activeMembership,
            role: "member" as const,
            productId: undefined,
            permissionGrants: undefined,
          }
        : activeMembership;
      return {
        ...cached.data,
        organization: {
          organization,
          membership: currentMembership,
          catalogManager: !cached.membership.productId,
        },
      };
    }

    const [organization, allProducts] = await Promise.all([
      withRequestPerformanceSpan("dashboard.selected-organization", () =>
        getOrganizationForSubject(subjectId, organizationId),
      ),
      listProductsForOrganizationDuringRender(organizationId),
    ]);
    const activeMemberships = organization.catalogManager
      ? []
      : (await listMembershipsForSubjectDuringRender(subjectId)).filter(
          (membership) => membership.status === "active",
        );
    const currentMembership = organization.catalogManager
      ? organization.membership
      : activeMemberships.find(
          (membership) => membership.organizationId === organizationId && !!membership.productId,
        );
    if (!currentMembership) throw new Error("Organization not found.");
    const allowedProductIds = new Set(
      activeMemberships
        .filter(
          (membership) => membership.organizationId === organizationId && membership.productId,
        )
        .map((membership) => membership.productId!),
    );
    if (!organization.catalogManager && allowedProductIds.size === 0) {
      throw new Error("Organization not found.");
    }
    const data: OrganizationDashboardData = {
      organization,
      products: allProducts
        .filter(
          (product) =>
            !product.archivedAt &&
            !product.deletionStartedAt &&
            !product.deletedAt &&
            (organization.catalogManager || allowedProductIds.has(product.productId)),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
    setCachedOrganizationDashboardData(subjectId, organizationId, data, currentMembership);
    return data;
  });
});
