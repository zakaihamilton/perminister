import {
  authorizeApiKey,
  getSessionFromToken,
  type AuthorizationRequest,
} from "@/lib/auth/service";
import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import { withRequestPerformance } from "@/lib/auth/performance";
import {
  bearerToken,
  isJsonRequest,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Vary: "Authorization, X-Perminister-Client-Id",
};

function isAuthorizationRequest(value: unknown): value is AuthorizationRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const resourcePart = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  return (
    typeof candidate.organizationId === "string" &&
    identifier.test(candidate.organizationId) &&
    typeof candidate.productId === "string" &&
    resourcePart.test(candidate.productId) &&
    (candidate.resourceKind === "product" ||
      candidate.resourceKind === "project" ||
      candidate.resourceKind === "workspace") &&
    (candidate.resourceId === undefined ||
      (typeof candidate.resourceId === "string" && resourcePart.test(candidate.resourceId))) &&
    (candidate.resourceKind === "product" ||
      (typeof candidate.resourceId === "string" && resourcePart.test(candidate.resourceId))) &&
    typeof candidate.action === "string" &&
    /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(candidate.action)
  );
}

function authorizationResultResponse(
  result: Awaited<ReturnType<typeof authorizeApiKey>>,
): Response {
  return Response.json(
    result.authorized
      ? {
          authorized: true,
          ...(result.subjectId ? { subjectId: result.subjectId } : {}),
          ...(result.servicePrincipalId ? { servicePrincipalId: result.servicePrincipalId } : {}),
        }
      : { authorized: false },
    { status: result.authorized ? 200 : 403, headers: noStoreHeaders },
  );
}

export function POST(request: Request): Promise<Response> {
  return withRequestPerformance(
    "POST /api/authorize",
    () => authorizePost(request),
    (response) => response.status,
  );
}

async function authorizePost(request: Request): Promise<Response> {
  if (!isJsonRequest(request)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: noStoreHeaders },
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > 8192) {
    return Response.json(
      { error: "Request body is too large." },
      { status: 413, headers: noStoreHeaders },
    );
  }
  const token = bearerToken(request);
  if (!token) {
    return Response.json(
      { error: "A bearer API key is required." },
      { status: 401, headers: noStoreHeaders },
    );
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, 8192);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { error: "Request body is too large." },
        { status: 413, headers: noStoreHeaders },
      );
    }
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  if (!isAuthorizationRequest(body)) {
    return Response.json(
      {
        error: "Provide organizationId, productId, resourceKind, optional resourceId, and action.",
      },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const normalizedBody: AuthorizationRequest = {
    ...body,
    organizationId: body.organizationId.toLowerCase(),
    productId: body.productId.toLowerCase(),
    ...(body.resourceId === undefined ? {} : { resourceId: body.resourceId.toLowerCase() }),
  };
  try {
    const isApiKey = /^pmk_[0-9a-f-]{36}_/i.test(token);
    if (isApiKey) {
      const result = await authorizeApiKey(token, normalizedBody);
      return authorizationResultResponse(result);
    }

    const [client, session] = await Promise.all([
      authenticateConsumerClient(request),
      getSessionFromToken(token),
    ]);
    if (
      !client ||
      !session ||
      client.productId !== normalizedBody.productId ||
      session.session.applicationClientId !== client.clientId ||
      session.session.productId !== client.productId
    ) {
      return Response.json({ authorized: false }, { status: 403, headers: noStoreHeaders });
    }
    const result = await authorizeApiKey(token, normalizedBody, client.clientId, session);
    return authorizationResultResponse(result);
  } catch {
    return Response.json(
      { error: "Authorization service is temporarily unavailable." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
