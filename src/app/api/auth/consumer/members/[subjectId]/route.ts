import {
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import {
  authenticationRequired,
  consumerRequestContext,
  consumerServiceError,
} from "@/lib/auth/consumer-route";
import { consumerProductPolicy } from "@/lib/auth/consumer-policy";
import { removeConsumerMember, updateConsumerMember } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ subjectId: string }> };
const organizationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function validScope(value: Record<string, unknown>) {
  return (
    typeof value.organizationId === "string" &&
    organizationIdPattern.test(value.organizationId) &&
    (value.scopeKind === "workspace" || value.scopeKind === "project") &&
    typeof value.resourceId === "string" &&
    resourceIdPattern.test(value.resourceId)
  );
}

async function readUpdateBody(request: Request): Promise<unknown | Response> {
  if (!isJsonRequest(request)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: NO_STORE_HEADERS },
    );
  }
  try {
    return await readBoundedJson(request, 16 * 1024);
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
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await consumerRequestContext(request);
  if (auth instanceof Response) return auth;
  if (!auth) return authenticationRequired();
  const body = await readUpdateBody(request);
  if (body instanceof Response) return body;
  const policy = consumerProductPolicy(auth.client.clientId);
  if (
    !isJsonObject(body) ||
    !validScope(body) ||
    !policy ||
    body.scopeKind !== policy.scopeKind ||
    (body.role !== undefined && typeof body.role !== "string") ||
    (body.status !== undefined && body.status !== "active" && body.status !== "disabled") ||
    (body.password !== undefined && typeof body.password !== "string") ||
    (body.role === undefined && body.status === undefined && body.password === undefined)
  ) {
    return Response.json(
      { error: "Provide a valid resource scope and role, status, or password change." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const { subjectId } = await context.params;
  try {
    await updateConsumerMember(auth.current.subject.subjectId, auth.client.clientId, subjectId, {
      organizationId: body.organizationId as string,
      productId: auth.client.productId,
      scopeKind: body.scopeKind as "workspace" | "project",
      resourceId: body.resourceId as string,
      ...(typeof body.role === "string" ? { role: body.role } : {}),
      ...(body.status === "active" || body.status === "disabled" ? { status: body.status } : {}),
      ...(typeof body.password === "string" ? { password: body.password } : {}),
    });
    return Response.json({ updated: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Member service is temporarily unavailable.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await consumerRequestContext(request);
  if (auth instanceof Response) return auth;
  if (!auth) return authenticationRequired();
  const body = await readUpdateBody(request);
  if (body instanceof Response) return body;
  const policy = consumerProductPolicy(auth.client.clientId);
  if (!isJsonObject(body) || !validScope(body) || !policy || body.scopeKind !== policy.scopeKind) {
    return Response.json(
      { error: "Provide a valid resource scope." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const { subjectId } = await context.params;
  try {
    await removeConsumerMember(auth.current.subject.subjectId, auth.client.clientId, subjectId, {
      organizationId: body.organizationId as string,
      productId: auth.client.productId,
      scopeKind: body.scopeKind as "workspace" | "project",
      resourceId: body.resourceId as string,
    });
    return Response.json({ removed: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Member service is temporarily unavailable.");
  }
}
