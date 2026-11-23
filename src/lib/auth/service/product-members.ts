import "server-only";

import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  type MembershipRecord,
  newMembershipId,
  newOrganizationMembershipId,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type OrganizationRole,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { requireProductRoleUnlocked } from "./core";
import {
  appendRecordActivityEvent,
  listRecordsWithRecovery,
  loadSubjectByEmailUnlocked,
  mapMembershipsToSubjectContact,
  persistRecord,
  store,
} from "./persistence";
import type { ProductMemberView } from "./products";
import {
  accessRoleSnapshot,
  canonicalEmail,
  isEmailVerifiedOrExemptForProduct,
  validateActions,
  validateScope,
} from "./validators";

export async function listProductMembers(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  options: { includeDisabled?: boolean } = {},
): Promise<ProductMemberView[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner", "admin"]);
    const memberships = (await store().listOrganizationMemberships(organizationId, productId))
      .filter(
        (record) =>
          record.productId === productId && (options.includeDisabled || record.status === "active"),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return mapMembershipsToSubjectContact(memberships);
  });
}

async function productMemberMutationContextUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: SubjectId,
) {
  const owner = await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner"]);
  const current = await store().readOrganizationMembership(organizationId, subjectId, productId);
  return { owner, current };
}

type ProductMemberMutationContext = Awaited<
  ReturnType<typeof productMemberMutationContextUnlocked>
>;

async function withProductMemberMutation<Result>(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
  operation: (context: ProductMemberMutationContext) => Promise<Result>,
): Promise<Result> {
  assertOpaqueId(subjectId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () =>
      operation(
        await productMemberMutationContextUnlocked(
          actorId,
          organizationId,
          productId,
          subjectId as SubjectId,
        ),
      ),
    ),
  );
}

export async function updateProductMemberRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
  role: OrganizationRole,
): Promise<void> {
  return withProductMemberMutation(
    actorId,
    organizationId,
    productId,
    subjectId,
    async ({ owner, current }) => {
      if (!current || current.status !== "active") throw new Error("Product member not found.");
      if (current.role === role) return;
      const members = await store().listOrganizationMemberships(organizationId, productId);
      const owners = members.filter(
        (membership) =>
          membership.productId === productId &&
          membership.role === "owner" &&
          membership.status === "active",
      );
      if (current.role === "owner" && role !== "owner" && owners.length <= 1) {
        throw new Error("A product must keep at least one owner.");
      }
      await persistRecord(
        { ...current, role, updatedAt: new Date().toISOString() },
        "product.member-role-updated",
        { kind: "subject", subjectId: owner.subjectId },
        { changes: [{ field: "role", before: current.role, after: role }] },
      );
    },
  );
}

export async function removeProductMember(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
): Promise<void> {
  return withProductMemberMutation(
    actorId,
    organizationId,
    productId,
    subjectId,
    async ({ owner, current }) => {
      if (!current) throw new Error("Product member not found.");
      if (current.status === "active" && current.role === "owner") {
        const owners = (
          await store().listOrganizationMemberships(organizationId, productId)
        ).filter(
          (membership) =>
            membership.productId === productId &&
            membership.role === "owner" &&
            membership.status === "active",
        );
        if (owners.length <= 1) throw new Error("A product must keep at least one owner.");
      }
      if (current.status === "active") {
        const now = new Date().toISOString();
        const disabled = {
          ...current,
          status: "disabled" as const,
          permissionGrants: (current.permissionGrants ?? []).map((grant) => ({
            ...grant,
            status: "disabled" as const,
            updatedAt: now,
          })),
          updatedAt: now,
        };
        await persistRecord(disabled, "product.member-removed", {
          kind: "subject",
          subjectId: owner.subjectId,
        });
      }
      const keys = (await listRecordsWithRecovery("api-key"))
        .map((entry) => entry.record)
        .filter(
          (key) =>
            key.owner.kind === "subject" &&
            key.owner.subjectId === subjectId &&
            key.scope.organizationId === organizationId &&
            key.scope.productId === productId &&
            key.status === "active",
        );
      for (const key of keys) {
        await persistRecord(
          { ...key, status: "revoked", revokedAt: new Date().toISOString() },
          "product.member-keys-revoked",
          { kind: "subject", subjectId: owner.subjectId },
        );
      }
    },
  );
}

export async function addExistingProductMemberByEmail(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  emailInput: string,
  accessRoleIdInput: string,
  membershipRoleInput: string,
): Promise<"added" | "updated" | "already-assigned"> {
  const scope = validateScope({
    kind: "product",
    organizationId: organizationId as OrganizationId,
    productId,
  });
  const email = canonicalEmail(emailInput);
  const accessRoleId = accessRoleIdInput.trim();
  const membershipRole = membershipRoleInput.trim();
  if (!/^role-[0-9a-f]{32}$/.test(accessRoleId)) {
    throw new Error("Choose a valid product access role.");
  }
  if (membershipRole !== "admin" && membershipRole !== "member") {
    throw new Error("Choose a valid product membership role.");
  }

  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actorMembership = await requireProductRoleUnlocked(
        actorId,
        scope.organizationId,
        scope.productId,
        ["owner", "admin"],
      );
      if (membershipRole === "admin" && actorMembership.role !== "owner") {
        throw new Error("Only the product owner can add a product administrator.");
      }
      const product = await store().readProduct(scope.organizationId, scope.productId);
      if (!product) throw new Error("Choose a product in this organization.");
      if (product.archivedAt || product.deletionStartedAt || product.deletedAt) {
        throw new Error("This product is archived. Restore it before making changes.");
      }
      const role = product.accessRoles?.find((item) => item.id === accessRoleId);
      if (!role) throw new Error("Choose an access role configured for this product.");
      if (role.deprecated) {
        throw new Error("This product permission set has been retired and cannot be assigned.");
      }
      if (role.scopeKinds && !role.scopeKinds.includes("product")) {
        throw new Error("Choose a permission set that supports product access.");
      }
      const actions = validateActions(role.actions);
      const target = await loadSubjectByEmailUnlocked(email);
      if (
        !target ||
        target.status !== "active" ||
        !isEmailVerifiedOrExemptForProduct(target, scope.productId)
      ) {
        throw new Error("No active, verified Perminister account was found. No invitation was sent.");
      }

      const productMembership = await store().readOrganizationMembership(
        scope.organizationId,
        target.subjectId,
        scope.productId,
      );
      if (productMembership?.status === "disabled") {
        throw new Error("This person's product membership is disabled. Reactivate it before assigning a role.");
      }
      if (
        productMembership &&
        productMembership.role !== "owner" &&
        productMembership.role !== membershipRole &&
        actorMembership.role !== "owner"
      ) {
        throw new Error("Only the product owner can change a member's Perminister product role.");
      }

      const productGrants = (productMembership?.permissionGrants ?? []).filter(
        (grant) =>
          grant.scope.kind === "product" &&
          grant.scope.organizationId === scope.organizationId &&
          grant.scope.productId === scope.productId,
      );
      const activeProductGrants = productGrants.filter((grant) => grant.status === "active");
      if (activeProductGrants.length > 0) {
        if (!activeProductGrants.every((grant) => grant.accessRole?.id === role.id)) {
          throw new Error("This person already has a different product role. Review the existing permissions first.");
        }
      }
      if (activeProductGrants.length === 0 && productGrants.length > 0) {
        throw new Error("This person's product role is disabled. Restore it before assigning a role.");
      }

      const now = new Date().toISOString();
      const actor = { kind: "subject" as const, subjectId: actorMembership.subjectId };
      const grantExists = activeProductGrants.length > 0;
      if (!grantExists) {
        const permissionGrant: MembershipRecord = {
          kind: "membership",
          schemaVersion: 1,
          membershipId: newMembershipId(),
          subjectId: target.subjectId,
          scope,
          grants: [{ scope, actions }],
          accessRole: accessRoleSnapshot(role),
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
        if (productMembership) {
          await persistRecord(permissionGrant, "permission.granted", actor, {
            accessRoleName: role.name,
            changes: [{ field: "actions", before: [], after: actions }],
          });
        } else {
          const membership: OrganizationMembershipRecord = {
            kind: "organization-membership",
            schemaVersion: 1,
            organizationMembershipId: newOrganizationMembershipId(),
            organizationId: scope.organizationId,
            productId: scope.productId,
            subjectId: target.subjectId,
            role: membershipRole,
            status: "active",
            permissionGrants: [permissionGrant],
            createdAt: now,
            updatedAt: now,
          };
          await persistRecord(membership, "product.member-added", actor, {
            accessRoleName: role.name,
            changes: [
              { field: "role", before: "None", after: membership.role },
              { field: "actions", before: [], after: actions },
            ],
          });
          await appendRecordActivityEvent(permissionGrant, "permission.granted", actor, {
            accessRoleName: role.name,
            changes: [{ field: "actions", before: [], after: actions }],
          });
        }
      }

      if (productMembership && productMembership.role !== "owner") {
        const updatedMembership = await store().readOrganizationMembership(
          scope.organizationId,
          target.subjectId,
          scope.productId,
        );
        if (!updatedMembership) throw new Error("Product membership not found.");
        const nextMembershipRole = membershipRole;
        if (updatedMembership.role !== nextMembershipRole) {
          await persistRecord(
            {
              ...updatedMembership,
              role: nextMembershipRole,
              updatedAt: new Date().toISOString(),
            },
            "product.member-role-updated",
            actor,
            {
              changes: [
                { field: "role", before: updatedMembership.role, after: nextMembershipRole },
              ],
            },
          );
          return grantExists ? "updated" : "added";
        }
      }
      return grantExists ? "already-assigned" : "added";
    }),
  );
}
