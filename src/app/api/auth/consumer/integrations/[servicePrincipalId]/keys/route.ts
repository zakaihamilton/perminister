import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import {
  bearerToken,
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import {
  createApiKeyForServicePrincipal,
  getConsumerSessionFromToken,
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
  const client = authenticateConsumerClient(request);
  const token = bearerToken(request);
  if (!client || !token) {
    return Response.json(
      { error: "Authentication is required." },
      {
        status: 401,
        headers: NO_STORE_HEADERS,
      },
    );
  }
  const { servicePrincipalId } = await context.params;
  try {
    const current = await getConsumerSessionFromToken(token, client.clientId);
    if (!current || current.session.productId !== client.productId) {
      return Response.json(
        { error: "Authentication is required." },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        },
      );
    }
    const keys = await listApiKeysForServicePrincipal(
      current.subject.subjectId,
      servicePrincipalId,
      client.productId,
    );
    return Response.json({ keys: keys.map(publicKey) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("permission")
      ? 403
      : message.includes("Integration not found") || message.includes("Organization not found")
        ? 404
        : 503;
    return Response.json(
      {
        error:
          status === 403
            ? "You cannot manage this integration."
            : "Integration keys are temporarily unavailable.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const client = authenticateConsumerClient(request);
  const token = bearerToken(request);
  if (!client || !token) {
    return Response.json(
      { error: "Authentication is required." },
      {
        status: 401,
        headers: NO_STORE_HEADERS,
      },
    );
  }
  if (!isJsonRequest(request)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      {
        status: 415,
        headers: NO_STORE_HEADERS,
      },
    );
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? "Request body is too large."
            : "Request body must be valid JSON.",
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: NO_STORE_HEADERS },
    );
  }
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
    const current = await getConsumerSessionFromToken(token, client.clientId);
    if (!current || current.session.productId !== client.productId) {
      return Response.json(
        { error: "Authentication is required." },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        },
      );
    }
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
