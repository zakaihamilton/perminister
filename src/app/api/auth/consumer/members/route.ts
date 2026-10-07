import {
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import {
  consumerServiceError,
  consumerRequestContext,
  authenticationRequired,
} from "@/lib/auth/consumer-route";
import { consumerProductPolicy } from "@/lib/auth/consumer-policy";
import { createConsumerMember, listConsumerMembers } from "@/lib/auth/service";

export const runtime = "nodejs";

const organizationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

export async function GET(request: Request) {
  const context = await consumerRequestContext(request);
  if (context instanceof Response) return context;
  if (!context) return authenticationRequired();
  const params = new URL(request.url).searchParams;
  const scope = {
    organizationId: params.get("organizationId") ?? "",
    scopeKind: params.get("scopeKind") ?? "",
    resourceId: params.get("resourceId") ?? "",
  };
  if (!validScope(scope)) {
    return Response.json(
      { error: "Provide organizationId, scopeKind, and resourceId." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const members = await listConsumerMembers(
      context.current.subject.subjectId,
      context.client.clientId,
      {
        ...scope,
        scopeKind: scope.scopeKind as "workspace" | "project",
        productId: context.client.productId,
      },
    );
    return Response.json({ members }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Member service is temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  const context = await consumerRequestContext(request);
  if (context instanceof Response) return context;
  if (!context) return authenticationRequired();
  if (!isJsonRequest(request)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: NO_STORE_HEADERS },
    );
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, 16 * 1024);
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
  const policy = consumerProductPolicy(context.client.clientId);
  if (
    !isJsonObject(body) ||
    !validScope(body) ||
    !policy ||
    body.scopeKind !== policy.scopeKind ||
    typeof body.role !== "string" ||
    body.role.length > 32 ||
    (body.email !== undefined && typeof body.email !== "string") ||
    (body.username !== undefined && typeof body.username !== "string") ||
    (body.password !== undefined && typeof body.password !== "string")
  ) {
    return Response.json(
      { error: "Provide a valid resource scope, role, and email or username." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const result = await createConsumerMember(
      context.current.subject.subjectId,
      context.client.clientId,
      {
        organizationId: body.organizationId as string,
        productId: context.client.productId,
        scopeKind: body.scopeKind as "workspace" | "project",
        resourceId: body.resourceId as string,
        email: body.email as string | undefined,
        username: body.username as string | undefined,
        password: body.password as string | undefined,
        role: body.role,
      },
    );
    return Response.json(
      { member: result.member, accountCreated: result.created },
      { status: result.created ? 201 : 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return consumerServiceError(error, "Member service is temporarily unavailable.");
  }
}
