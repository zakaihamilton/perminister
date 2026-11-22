import "server-only";

import { randomBytes } from "node:crypto";
import { fetchPublicProductRoleCatalog } from "../../product-discovery";
import type { ProductAccessRole, ProductRoleCatalogEntry } from "../access-roles";
import { withOrganizationMutationLock } from "../coordination";
import type { OrganizationMembershipRecord, ProductRecord, SubjectId } from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { parseProductRoleCatalog } from "../role-catalog";
import { requireProductRoleUnlocked } from "./core";
import { persistRecord, store } from "./persistence";
import { getProductAccessForSubject } from "./products";
import { validateActions } from "./validators";

function normalizeProductAccessRoleInput(input: {
  name: string;
  description: string;
  actions: readonly string[];
}): Pick<ProductAccessRole, "name" | "description" | "actions"> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Enter a role name up to 80 characters.");
  }
  if (description.length > 240 || /[\u0000-\u001f\u007f]/.test(description)) {
    throw new Error("The role description must be 240 characters or fewer.");
  }
  const actions = validateActions(input.actions);
  return { name, description, actions };
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

function withProductAccessRoleMutation<T>(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  mutation: (
    manageableProduct: Awaited<ReturnType<typeof requireManageableProductUnlocked>>,
  ) => Promise<T>,
): Promise<T> {
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const manageableProduct = await requireManageableProductUnlocked(
        actorId,
        organizationId,
        productId,
      );
      return mutation(manageableProduct);
    }),
  );
}

export async function stageProductAccessRoleCatalog(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
) {
  const access = await getProductAccessForSubject(actorId, organizationId, productId);
  if (access.membership?.role !== "owner" && access.membership?.role !== "admin") {
    throw new Error("You do not have permission to manage this product.");
  }
  if (access.product.sharedProductRef) {
    throw new Error("Shared access roles are controlled by the publishing organization.");
  }

  const catalog = parseProductRoleCatalog(
    await fetchPublicProductRoleCatalog(access.product.websiteUrl),
    access.product.productId,
  );
  const fetchedAt = new Date().toISOString();
  return withProductAccessRoleMutation(
    actorId,
    organizationId,
    productId,
    async ({ actor, product }) => {
      if (product.websiteUrl !== access.product.websiteUrl) {
        throw new Error("The registered product website changed. Fetch the catalog again.");
      }
      const stagedAccessRoleCatalog = {
        catalog,
        fetchedAt,
        websiteUrl: product.websiteUrl,
      };
      await persistRecord(
        { ...product, stagedAccessRoleCatalog, updatedAt: fetchedAt },
        "product.access-role-catalog-staged",
        { kind: "subject", subjectId: actor.subjectId },
        { catalogVersion: catalog.version, roleCount: catalog.roles.length },
      );
      return stagedAccessRoleCatalog;
    },
  );
}

export async function applyProductAccessRoleCatalog(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductAccessRole[]> {
  return withProductAccessRoleMutation(
    actorId,
    organizationId,
    productId,
    async ({ actor, product }) => {
      const staged = product.stagedAccessRoleCatalog;
      if (!staged) throw new Error("Fetch a product role catalog before applying it.");
      if (staged.websiteUrl !== product.websiteUrl) {
        throw new Error("The registered product website changed. Fetch the catalog again.");
      }

      const currentRoles = product.accessRoles ?? [];
      const manualRoles = currentRoles.filter((role) => !role.catalogSource);
      const catalogRoles = currentRoles.filter((role) => !!role.catalogSource);
      const existingBySourceId = new Map(
        catalogRoles.map((role) => [role.catalogSource!.roleId, role]),
      );
      const incomingIds = new Set(staged.catalog.roles.map((role) => role.id));
      const importedRoles = staged.catalog.roles.map((entry: ProductRoleCatalogEntry) => {
        const existing = existingBySourceId.get(entry.id);
        return {
          id: existing?.id ?? `role-${randomBytes(16).toString("hex")}`,
          name: entry.name,
          description: entry.description,
          actions: validateActions(entry.actions),
          role: entry.role,
          scopeKinds: entry.scopeKinds,
          catalogSource: { roleId: entry.id, version: staged.catalog.version },
          deprecated: false,
        } satisfies ProductAccessRole;
      });
      const retiredRoles = catalogRoles
        .filter((role) => !incomingIds.has(role.catalogSource!.roleId))
        .map((role) => ({ ...role, deprecated: true }));
      const nextRoles = [...manualRoles, ...importedRoles, ...retiredRoles];
      if (nextRoles.filter((role) => !role.deprecated).length > 32) {
        throw new Error("A product can have up to 32 access roles.");
      }
      const names = nextRoles
        .filter((role) => !role.deprecated)
        .map((role) => role.name.toLowerCase());
      if (new Set(names).size !== names.length) {
        throw new Error("A product role name conflicts with an existing permission set.");
      }

      const importedAt = new Date().toISOString();
      const { stagedAccessRoleCatalog: _staged, ...productWithoutStage } = product;
      await persistRecord(
        {
          ...productWithoutStage,
          accessRoles: nextRoles,
          roleCatalogVersion: staged.catalog.version,
          roleCatalogImportedAt: importedAt,
          updatedAt: importedAt,
        },
        "product.access-role-catalog-applied",
        { kind: "subject", subjectId: actor.subjectId },
        {
          catalogVersion: staged.catalog.version,
          roleCount: importedRoles.length,
          deprecatedRoleCount: retiredRoles.length,
        },
      );
      return nextRoles;
    },
  );
}

export async function createProductAccessRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  input: { name: string; description: string; actions: readonly string[] },
): Promise<ProductAccessRole> {
  const { name, description, actions } = normalizeProductAccessRoleInput(input);
  return withProductAccessRoleMutation(
    actorId,
    organizationId,
    productId,
    async ({ actor, product }) => {
      const roles = product.accessRoles ?? [];
      if (roles.filter((role) => !role.deprecated).length >= 32) {
        throw new Error("A product can have up to 32 access roles.");
      }
      if (
        roles.some(
          (role) => !role.deprecated && role.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
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
    },
  );
}

export async function updateProductAccessRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  accessRoleId: string,
  input: { name: string; description: string; actions: readonly string[] },
): Promise<ProductAccessRole> {
  if (!/^role-[0-9a-f]{32}$/.test(accessRoleId)) throw new Error("Choose an access role.");
  const { name, description, actions } = normalizeProductAccessRoleInput(input);
  return withProductAccessRoleMutation(
    actorId,
    organizationId,
    productId,
    async ({ actor, product }) => {
      const roles = product.accessRoles ?? [];
      const currentRole = roles.find((role) => role.id === accessRoleId);
      if (!currentRole) throw new Error("Access role not found.");
      if (currentRole.catalogSource) {
        throw new Error("Product-published permission sets are managed by their role catalog.");
      }
      if (
        roles.some(
          (role) =>
            role.id !== accessRoleId &&
            !role.deprecated &&
            role.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new Error("An access role with that name already exists.");
      }
      const updatedRole: ProductAccessRole = {
        ...currentRole,
        name,
        description,
        actions,
      };
      await persistRecord(
        {
          ...product,
          accessRoles: roles.map((role) => (role.id === accessRoleId ? updatedRole : role)),
          updatedAt: new Date().toISOString(),
        },
        "product.access-role-updated",
        { kind: "subject", subjectId: actor.subjectId },
        {
          accessRoleId,
          accessRoleName: name,
          changes: [
            { field: "name", before: currentRole.name, after: name },
            { field: "description", before: currentRole.description, after: description },
            { field: "actions", before: currentRole.actions, after: actions },
          ],
        },
      );
      return updatedRole;
    },
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
      if (roles.some((role) => role.id === accessRoleId && role.catalogSource)) {
        throw new Error("Product-published permission sets are managed by their role catalog.");
      }
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
