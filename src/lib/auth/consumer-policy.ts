import type { ResourceScope } from "./domain";

export type ConsumerScopeKind = "workspace" | "project";
export type ConsumerMemberRole = "admin" | "editor" | "viewer";

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

export function consumerProductPolicy(clientId: string): ConsumerProductPolicy | null {
  return POLICIES[clientId.trim().toLowerCase()] ?? null;
}

export function consumerRoleActions(clientId: string, role: string): readonly string[] | null {
  return consumerProductPolicy(clientId)?.roles[role] ?? null;
}

export function scopeResourceId(scope: ResourceScope): string | null {
  if (scope.kind === "project") return scope.projectId;
  if (scope.kind === "workspace") return scope.workspaceId;
  return null;
}
