import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import {
  consumerIntegrationError,
  requireConsumerJsonRequest,
  requireConsumerRequestContext,
} from "@/lib/auth/consumer-route";
import {
  createApiKeyForServicePrincipal,
  listApiKeysForServicePrincipal,
  type CreateApiKeyOptions,
} from "@/lib/auth/service";
import type { ResourceScope } from "@/lib/auth/domain";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ servicePrincipalId: string }> };

function parseOptions(value: unknown, productId: string): CreateApiKeyOptions | null {
  if (!isJsonObject(value)) return null;
  const organizationId = value.organizationId;
  const scopeKind = value.scopeKind;
  const actions = value.actions;
  const expiresAt = value.expiresAt;
  const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    typeof organizationId !== "string" ||
    !identifier.test(organizationId) ||
    !Array.isArray(actions) ||
    actions.length < 1 ||
    actions.length > 32 ||
    !actions.every((action) => typeof action === "string") ||
    !(expiresAt === undefined || expiresAt === null || typeof expiresAt === "string")
  ) {
    return null;
  }
  let scope: ResourceScope;
  if (scopeKind === "product") {
    scope = {
      kind: "product",
      organizationId: organizationId as ResourceScope["organizationId"],
      productId,
    };
  } else if (
    (scopeKind === "project" || scopeKind === "workspace") &&
    typeof value.resourceId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.resourceId)
  ) {
    scope =
      scopeKind === "project"
        ? {
            kind: "project",
            organizationId: organizationId as ResourceScope["organizationId"],
            productId,
            projectId: value.resourceId,
          }
        : {
            kind: "workspace",
            organizationId: organizationId as ResourceScope["organizationId"],
            productId,
            workspaceId: value.resourceId,
          };
  } else {
    return null;
  }
  return {
    scope,
    actions: actions as string[],
    expiresAt: typeof expiresAt === "string" && expiresAt.trim() ? expiresAt : null,
    ...(typeof value.rotateFromApiKeyId === "string"
      ? { rotateFromApiKeyId: value.rotateFromApiKeyId }
      : {}),
  };
}

function publicKey(record: Awaited<ReturnType<typeof listApiKeysForServicePrincipal>>[number]) {
  return {
    apiKeyId: record.apiKeyId,
    keyClass: record.keyClass,
    scope: record.scope,
    actions: record.actions,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    rotatedFromApiKeyId: record.rotatedFromApiKeyId,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireConsumerRequestContext(request);
  if (auth instanceof Response) return auth;
  const { client, current } = auth;
  const { servicePrincipalId } = await context.params;
  try {
    const keys = await listApiKeysForServicePrincipal(
      current.subject.subjectId,
      servicePrincipalId,
      client.productId,
    );
    return Response.json({ keys: keys.map(publicKey) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerIntegrationError(
      error,
      "Integration keys are temporarily unavailable.",
      "Integration keys are temporarily unavailable.",
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const parsed = await requireConsumerJsonRequest(request, 8 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, client, current } = parsed;
  const options = parseOptions(body, client.productId);
  if (!options) {
    return Response.json(
      { error: "Provide a valid scope, organizationId, actions, and expiration." },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }
  const { servicePrincipalId } = await context.params;
  try {
    const created = await createApiKeyForServicePrincipal(
      current.subject.subjectId,
      servicePrincipalId,
      options,
    );
    return Response.json(
      {
        key: publicKey(created.record),
        token: created.token,
        rotationWarning: created.rotationWarning,
      },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Integration key could not be created.";
    const status = message.includes("permission")
      ? 403
      : /not found/i.test(message)
        ? 404
        : /Choose|valid|future|scope|action|key can only/i.test(message)
          ? 400
          : 503;
    return Response.json(
      {
        error:
          status === 403
            ? "You cannot manage this integration."
            : status === 400
              ? message
              : status === 404
                ? "Integration not found."
                : "Integration key service is temporarily unavailable.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
