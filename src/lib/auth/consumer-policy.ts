import type { ResourceScope } from "./domain";

export type ConsumerScopeKind = "workspace" | "project";

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ConsumerProductPolicy {
  scopeKind: ConsumerScopeKind;
  roles: Readonly<Record<string, readonly string[]>>;
  memberManagementAction: string;
  accountManagementAction?: string;
  platformAdminActions?: readonly string[];
}

const POLICIES: Readonly<Record<string, ConsumerProductPolicy>> = {
  visitoring: {
    scopeKind: "workspace",
    memberManagementAction: "visitoring:members:manage",
    roles: {
      viewer: ["visitoring:workspace:read"],
      admin: ["visitoring:workspace:read", "visitoring:members:manage"],
    },
  },
  postparticle: {
    scopeKind: "project",
    memberManagementAction: "postparticle:members:manage",
    accountManagementAction: "postparticle:accounts:manage",
    roles: {
      viewer: ["postparticle:project:read"],
      editor: ["postparticle:project:read", "postparticle:project:write"],
      admin: [
        "postparticle:project:read",
        "postparticle:project:write",
        "postparticle:members:manage",
      ],
    },
    platformAdminActions: [
      "postparticle:project:read",
      "postparticle:project:write",
      "postparticle:members:manage",
      "postparticle:accounts:manage",
    ],
  },
};

export function consumerProductPolicy(productId: string): ConsumerProductPolicy | null {
  return POLICIES[productId.trim().toLowerCase()] ?? null;
}

export function consumerRoleActions(productId: string, role: string): readonly string[] | null {
  return consumerProductPolicy(productId)?.roles[role] ?? null;
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
