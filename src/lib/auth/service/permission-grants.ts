import "server-only";

import { cache } from "react";
import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  type MembershipRecord,
  newMembershipId,
  type OrganizationMembershipRecord,
  type ResourceScope,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { requireProductRoleUnlocked } from "./core";
import { invalidateOrganizationDashboardDataCache } from "./dashboard-cache";
import {
  appendRecordActivityEvent,
  loadRecord,
  loadSubjectUnlocked,
  organizationMembershipUnlocked,
  persistRecord,
  store,
} from "./persistence";
import {
  accessRoleSnapshot,
  isEmailVerifiedOrExemptForProduct,
  validateActions,
  validateScope,
} from "./validators";

export async function listProductPermissionGrants(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<MembershipRecord[]> {
  return authMutationQueue.run(async () => {
    const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
      "owner",
      "admin",
      "member",
    ]);
    return (await store().listOrganizationMemberships(organizationId, productId))
      .filter((membership) => membership.productId === productId)
      .flatMap((membership) => membership.permissionGrants ?? [])
      .filter(
        (grant) =>
          grant.scope.productId === productId &&
          (actor.role !== "member" || grant.subjectId === actorId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export const listOrganizationPermissionGrants = cache(
  async function listOrganizationPermissionGrants(
    subjectId: SubjectId,
    organizationId: string,
  ): Promise<MembershipRecord[]> {
    return authMutationQueue.read(async () => {
      const catalogManager = await organizationMembershipUnlocked(organizationId, subjectId);
      let memberships: OrganizationMembershipRecord[];
      if (!catalogManager) {
        memberships = await store().listMembershipsForSubject(subjectId);
        if (
          !memberships.some(
            (item) =>
              item.organizationId === organizationId && item.productId && item.status === "active",
          )
        ) {
          throw new Error("Organization not found.");
        }
        memberships = memberships.filter(
          (membership) => membership.organizationId === organizationId && !!membership.productId,
        );
      } else {
        memberships = await store().listOrganizationMemberships(organizationId);
      }
      const isCatalogManager = !!catalogManager;
      return memberships
        .filter((membership) => !!membership.productId)
        .flatMap((membership) => membership.permissionGrants ?? [])
        .filter(
          (record) =>
            record.scope.organizationId === organizationId &&
            (isCatalogManager || record.subjectId === subjectId),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    });
  },
);

export async function createPermissionGrant(
  actorId: SubjectId,
  targetSubjectId: string,
  scopeInput: ResourceScope,
  actionsInput: readonly string[],
  accessRoleIdInput?: string,
): Promise<MembershipRecord> {
  assertOpaqueId(targetSubjectId);
  const scope = validateScope(scopeInput);
  const accessRoleId = accessRoleIdInput?.trim();
  if (accessRoleId && !/^role-[0-9a-f]{32}$/.test(accessRoleId)) {
    throw new Error("Choose a valid product access role.");
  }
  const customActions = accessRoleId ? null : validateActions(actionsInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actorMembership = await requireProductRoleUnlocked(
        actorId,
        scope.organizationId,
        scope.productId,
        ["owner", "admin"],
      );
      const product = await store().readProduct(scope.organizationId, scope.productId);
      if (!product) throw new Error("Choose a product in this organization.");
      const role = accessRoleId
        ? product.accessRoles?.find((item) => item.id === accessRoleId)
        : undefined;
      if (accessRoleId && !role) {
        throw new Error("Choose an access role configured for this product.");
      }
      if (role?.deprecated) {
        throw new Error("This product permission set has been retired and cannot be assigned.");
      }
      if (role?.scopeKinds && !role.scopeKinds.includes(scope.kind)) {
        throw new Error("Choose a scope supported by this permission set.");
      }
      const actions = role ? validateActions(role.actions) : customActions;
      if (!actions) throw new Error("Enter 1 to 32 valid action names.");
      const target = await loadSubjectUnlocked(targetSubjectId);
      if (
        !target ||
        target.status !== "active" ||
        !isEmailVerifiedOrExemptForProduct(target, scope.productId)
      ) {
        throw new Error("Choose an active, email-verified account.");
      }
      const targetMembership = await store().readOrganizationMembership(
        scope.organizationId,
        targetSubjectId as SubjectId,
        scope.productId,
      );
      if (!targetMembership || targetMembership.status !== "active") {
        throw new Error("Choose a member of this product.");
      }
      const now = new Date().toISOString();
      const membership: MembershipRecord = {
        kind: "membership",
        schemaVersion: 1,
        membershipId: newMembershipId(),
        subjectId: target.subjectId,
        scope,
        grants: [{ scope, actions }],
        ...(role ? { accessRole: accessRoleSnapshot(role) } : {}),
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      await persistRecord(
        membership,
        "permission.granted",
        {
          kind: "subject",
          subjectId: actorMembership.subjectId,
        },
        {
          ...(role ? { accessRoleName: role.name } : {}),
          changes: [{ field: "actions", before: [], after: [...actions] }],
        },
      );
      return membership;
    }),
  );
}

export async function updateGrantStatus(
  actorId: SubjectId,
  membershipId: string,
  status: "active" | "disabled",
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(async () => {
    const initial = await loadRecord("membership", membershipId);
    if (!initial) throw new Error("Permission grant not found.");
    if (!initial.record.scope.organizationId)
      throw new Error("Legacy grants cannot be changed here.");
    await withOrganizationMutationLock(initial.record.scope.organizationId, async () => {
      const current = await loadRecord("membership", membershipId);
      if (!current || current.record.scope.organizationId !== initial.record.scope.organizationId)
        throw new Error("Permission grant not found.");
      const actorMembership = await requireProductRoleUnlocked(
        actorId,
        current.record.scope.organizationId,
        current.record.scope.productId,
        ["owner", "admin"],
      );
      if (
        status === "active" &&
        (
          await store().readOrganizationMembership(
            current.record.scope.organizationId,
            current.record.subjectId,
            current.record.scope.productId,
          )
        )?.status !== "active"
      ) {
        throw new Error("The person must be an active product member before restoring access.");
      }
      if (current.record.status === status) return;
      await persistRecord(
        { ...current.record, status, updatedAt: new Date().toISOString() },
        status === "disabled" ? "permission.revoked" : "permission.restored",
        { kind: "subject", subjectId: actorMembership.subjectId },
        { changes: [{ field: "status", before: current.record.status, after: status }] },
      );
    });
  });
}

export async function deletePermissionGrant(
  actorId: SubjectId,
  membershipId: string,
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(async () => {
    const initial = await loadRecord("membership", membershipId);
    if (!initial) throw new Error("Permission grant not found.");
    const { organizationId, productId } = initial.record.scope;

    await withOrganizationMutationLock(organizationId, async () => {
      const current = await loadRecord("membership", membershipId);
      if (
        !current ||
        current.record.scope.organizationId !== organizationId ||
        current.record.scope.productId !== productId
      ) {
        throw new Error("Permission grant not found.");
      }
      const actorMembership = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      if (current.record.status !== "disabled") {
        throw new Error("Only disabled permissions can be deleted.");
      }

      const productMembership = await store().readOrganizationMembership(
        organizationId,
        current.record.subjectId,
        productId,
      );
      const grants = productMembership?.permissionGrants ?? [];
      if (!productMembership || !grants.some((grant) => grant.membershipId === membershipId)) {
        throw new Error("Permission grant not found.");
      }

      await store().writeRecord({
        ...productMembership,
        permissionGrants: grants.filter((grant) => grant.membershipId !== membershipId),
        updatedAt: new Date().toISOString(),
      });
      invalidateOrganizationDashboardDataCache();
      await appendRecordActivityEvent(
        current.record,
        "permission.deleted",
        { kind: "subject", subjectId: actorMembership.subjectId },
        { changes: [{ field: "status", before: "disabled", after: "deleted" }] },
      );
    });
  });
}

export async function listMembershipsForSubject(subjectId: SubjectId): Promise<MembershipRecord[]> {
  return authMutationQueue.run(() => listMembershipsForSubjectUnlocked(subjectId));
}

async function listMembershipsForSubjectUnlocked(
  subjectId: SubjectId,
): Promise<MembershipRecord[]> {
  return (await store().listMembershipsForSubject(subjectId))
    .flatMap((membership) => membership.permissionGrants ?? [])
    .filter((record) => record.subjectId === subjectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
