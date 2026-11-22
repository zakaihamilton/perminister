import "server-only";

import {
  type ApiKeyId,
  assertOpaqueId,
  type OrganizationId,
  type ResourceScope,
  type ServicePrincipalId,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { equalHex, hashHex } from "./passwords";
import {
  loadApprovedOrganizationUnlocked,
  loadRecord,
  requireOrganizationProductUnlocked,
  store,
} from "./persistence";
import { getSessionFromToken } from "./sessions";
import {
  consumerProductState,
  isEmailVerifiedOrExempt,
  productMembershipHasPermission,
  validateActions,
  validateScope,
} from "./validators";

export interface AuthorizationRequest {
  organizationId: string;
  productId: string;
  resourceKind: "product" | "project" | "workspace";
  resourceId?: string;
  action: string;
  /** OAuth resource audience, required to match when the supplied session is resource-bound. */
  resource?: string;
}

function keyScopeAllows(keyScope: ResourceScope, request: ResourceScope): boolean {
  if (
    keyScope.organizationId.toLowerCase() !== request.organizationId.toLowerCase() ||
    keyScope.productId.toLowerCase() !== request.productId.toLowerCase()
  )
    return false;
  if (keyScope.kind === "product") return true;
  if (keyScope.kind !== request.kind) return false;
  if (keyScope.kind === "project" && request.kind === "project")
    return keyScope.projectId.toLowerCase() === request.projectId.toLowerCase();
  if (keyScope.kind === "workspace" && request.kind === "workspace")
    return keyScope.workspaceId.toLowerCase() === request.workspaceId.toLowerCase();
  return false;
}

function requestScope(input: AuthorizationRequest): ResourceScope {
  if (input.resourceKind === "product")
    return validateScope({
      kind: "product",
      organizationId: input.organizationId as OrganizationId,
      productId: input.productId,
    });
  if (input.resourceKind === "project" && input.resourceId) {
    return validateScope({
      kind: "project",
      organizationId: input.organizationId as OrganizationId,
      productId: input.productId,
      projectId: input.resourceId,
    });
  }
  if (input.resourceKind === "workspace" && input.resourceId) {
    return validateScope({
      kind: "workspace",
      organizationId: input.organizationId as OrganizationId,
      productId: input.productId,
      workspaceId: input.resourceId,
    });
  }
  throw new Error("A valid resource kind and ID are required.");
}

function parseApiKeyId(token: string): ApiKeyId | null {
  const match = /^pmk_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/i.exec(token);
  if (!match) return null;
  try {
    assertOpaqueId(match[1]);
    return match[1] as ApiKeyId;
  } catch {
    return null;
  }
}

export async function authorizeApiKey(
  token: string,
  input: AuthorizationRequest,
  applicationClientId?: string,
  preloadedSession?: Awaited<ReturnType<typeof getSessionFromToken>>,
): Promise<{
  authorized: boolean;
  subjectId?: SubjectId;
  servicePrincipalId?: ServicePrincipalId;
}> {
  const keyId = parseApiKeyId(token);
  const scope = requestScope(input);
  const action = validateActions([input.action])[0];
  if (!keyId) {
    const currentSession =
      preloadedSession !== undefined ? preloadedSession : await getSessionFromToken(token);
    if (
      !currentSession ||
      !currentSession.session.applicationClientId ||
      !applicationClientId ||
      currentSession.session.applicationClientId !== applicationClientId ||
      currentSession.session.productId !== scope.productId
    ) {
      return { authorized: false };
    }
    if (
      (currentSession.session.resource &&
        (input.resource !== currentSession.session.resource ||
          !currentSession.session.oauthScopes?.includes(action))) ||
      (!currentSession.session.resource && input.resource)
    ) {
      return { authorized: false };
    }
    return authMutationQueue.run(async () => {
      const [organization, productMembership] = await Promise.all([
        loadApprovedOrganizationUnlocked(scope.organizationId),
        store().readOrganizationMembership(
          scope.organizationId,
          currentSession.subject.subjectId,
          scope.productId,
        ),
      ]);
      if (!organization || !productMembership || productMembership.status !== "active") {
        return { authorized: false };
      }
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId, true);
      const authorized = productMembershipHasPermission(productMembership, scope, action);
      return authorized
        ? { authorized: true, subjectId: currentSession.subject.subjectId }
        : { authorized: false };
    });
  }
  const current = await loadRecord("api-key", keyId);
  if (!current) return { authorized: false };
  const key = current.record;
  if (
    key.status !== "active" ||
    (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) ||
    !equalHex(key.verifier.digestHex, hashHex(token)) ||
    !key.actions.includes(action) ||
    !keyScopeAllows(key.scope, scope)
  )
    return { authorized: false };
  if (key.owner.kind === "service") {
    const [principal] = await Promise.all([
      loadRecord("service-principal", key.owner.servicePrincipalId),
      requireOrganizationProductUnlocked(scope.organizationId, scope.productId, true),
    ]);
    if (
      !principal ||
      principal.record.status !== "active" ||
      principal.record.organizationId !== scope.organizationId ||
      principal.record.productId !== scope.productId
    ) {
      return { authorized: false };
    }
    return {
      authorized: true,
      servicePrincipalId: principal.record.servicePrincipalId,
    };
  }
  const [subject, organization, productMembership] = await Promise.all([
    loadRecord("subject", key.owner.subjectId),
    loadApprovedOrganizationUnlocked(scope.organizationId),
    store().readOrganizationMembership(scope.organizationId, key.owner.subjectId, scope.productId),
  ]);
  if (!subject || subject.record.status !== "active" || !isEmailVerifiedOrExempt(subject.record)) {
    return { authorized: false };
  }
  if (consumerProductState(subject.record, scope.productId).status !== "active") {
    return { authorized: false };
  }
  if (!organization) return { authorized: false };
  if (!productMembership || productMembership.status !== "active") return { authorized: false };
  const authorized = productMembershipHasPermission(productMembership, scope, action);
  return authorized
    ? { authorized: true, subjectId: subject.record.subjectId }
    : { authorized: false };
}
