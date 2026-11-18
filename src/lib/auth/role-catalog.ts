import type {
  ProductRoleCatalog,
  ProductRoleCatalogEntry,
  ProductRoleScopeKind,
} from "./access-roles";

const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ACTION_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const ROLE_VALUE_PATTERN = /^[a-z][a-z0-9._:-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const SCOPE_KINDS = new Set<ProductRoleScopeKind>(["product", "project", "workspace"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRole(value: unknown): ProductRoleCatalogEntry {
  const item = record(value);
  if (!item) throw new Error("The product returned an invalid role catalog.");
  const { id, name, description, actions, scopeKinds, role } = item;
  if (
    typeof id !== "string" ||
    !ROLE_ID_PATTERN.test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    typeof description !== "string" ||
    description.length > 240 ||
    /[\u0000-\u001f\u007f]/.test(description) ||
    !Array.isArray(actions) ||
    actions.length < 1 ||
    actions.length > 32 ||
    actions.some((action) => typeof action !== "string" || !ACTION_PATTERN.test(action)) ||
    !Array.isArray(scopeKinds) ||
    scopeKinds.length < 1 ||
    scopeKinds.length > 3 ||
    scopeKinds.some((scope) => typeof scope !== "string" || !SCOPE_KINDS.has(scope as ProductRoleScopeKind)) ||
    new Set(scopeKinds).size !== scopeKinds.length ||
    (role !== undefined && (typeof role !== "string" || !ROLE_VALUE_PATTERN.test(role)))
  ) {
    throw new Error("The product returned an invalid role catalog.");
  }
  const normalizedActions = [...new Set(actions as string[])];
  if (normalizedActions.length !== actions.length) {
    throw new Error("The product returned an invalid role catalog.");
  }
  return {
    id,
    name: name.trim().replace(/\s+/g, " "),
    description: description.trim(),
    actions: normalizedActions,
    scopeKinds: scopeKinds as ProductRoleScopeKind[],
    ...(typeof role === "string" ? { role } : {}),
  };
}

export function parseProductRoleCatalog(
  value: unknown,
  expectedProductId: string,
): ProductRoleCatalog {
  const catalog = record(value);
  if (
    !catalog ||
    catalog.schemaVersion !== 1 ||
    typeof catalog.productId !== "string" ||
    !PRODUCT_ID_PATTERN.test(catalog.productId) ||
    catalog.productId !== expectedProductId ||
    typeof catalog.version !== "string" ||
    catalog.version.length > 64 ||
    !VERSION_PATTERN.test(catalog.version) ||
    !Array.isArray(catalog.roles) ||
    catalog.roles.length < 1 ||
    catalog.roles.length > 32
  ) {
    throw new Error("The product returned an invalid role catalog.");
  }
  const roles = catalog.roles.map(parseRole);
  const ids = roles.map((role) => role.id);
  const names = roles.map((role) => role.name.toLowerCase());
  if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) {
    throw new Error("The product returned an invalid role catalog.");
  }
  return {
    schemaVersion: 1,
    productId: catalog.productId,
    version: catalog.version,
    roles,
  };
}
