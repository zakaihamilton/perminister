import type { ResourceScope } from "./domain";

export type ConsumerScopeKind = "workspace" | "project";

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ConsumerProductPolicy {
  memberManagementAction: string;
  accountManagementAction: string;
  platformAdminActions: readonly string[];
}

export function consumerProductPolicy(productId: string): ConsumerProductPolicy | null {
  const normalizedProductId = productId.trim().toLowerCase();
  if (!normalizedProductId) return null;
  return {
    memberManagementAction: normalizedProductId + ":members:manage",
    accountManagementAction: normalizedProductId + ":accounts:manage",
    platformAdminActions: [
      normalizedProductId + ":project:read",
      normalizedProductId + ":project:write",
      normalizedProductId + ":members:manage",
      normalizedProductId + ":accounts:manage",
    ],
  };
}

export function consumerRoleActions(
  productId: string,
  role: string,
  scopeKind: ConsumerScopeKind,
): readonly string[] | null {
  const normalizedProductId = productId.trim().toLowerCase();
  if (!normalizedProductId) return null;
  const resourceActions =
    scopeKind === "workspace"
      ? [normalizedProductId + ":workspace:read"]
      : [normalizedProductId + ":project:read", normalizedProductId + ":project:write"];
  if (role === "viewer") return [resourceActions[0]];
  if (role === "editor" && scopeKind === "project") return resourceActions;
  if (role === "admin") {
    return [...resourceActions, normalizedProductId + ":members:manage"];
  }
  return null;
}

export function isOrganizationId(value: unknown): value is string {
  return typeof value === "string" && ORGANIZATION_ID_PATTERN.test(value);
}

export function isConsumerResourceScope(value: Record<string, unknown>): boolean {
  return (
    isOrganizationId(value.organizationId) &&
    (value.scopeKind === "workspace" || value.scopeKind === "project") &&
    typeof value.resourceId === "string" &&
    RESOURCE_ID_PATTERN.test(value.resourceId)
  );
}

export function consumerMemberScopeInput(value: Record<string, unknown>, productId: string) {
  const resourceId = value.resourceId as string;
  return {
    organizationId: value.organizationId as string,
    productId,
    scopeKind: value.scopeKind as ConsumerScopeKind,
    resourceId:
      value.scopeKind === "project" || value.scopeKind === "workspace"
        ? resourceId.toLowerCase()
        : resourceId,
  };
}

export function scopeResourceId(scope: ResourceScope): string | null {
  if (scope.kind === "project") return scope.projectId.toLowerCase();
  if (scope.kind === "workspace") return scope.workspaceId.toLowerCase();
  return null;
}
