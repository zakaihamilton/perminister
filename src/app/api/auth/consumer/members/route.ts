import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import {
  consumerServiceError,
  requireConsumerRequestContext,
  requireConsumerJsonRequest,
} from "@/lib/auth/consumer-route";
import { consumerProductPolicy, isConsumerResourceScope } from "@/lib/auth/consumer-policy";
import { createConsumerMember, listConsumerMembers } from "@/lib/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await requireConsumerRequestContext(request);
  if (context instanceof Response) return context;
  const params = new URL(request.url).searchParams;
  const scope = {
    organizationId: params.get("organizationId") ?? "",
    scopeKind: params.get("scopeKind") ?? "",
    resourceId: params.get("resourceId") ?? "",
  };
  if (!isConsumerResourceScope(scope)) {
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
  const parsed = await requireConsumerJsonRequest(request, 16 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, ...context } = parsed;
  const policy = consumerProductPolicy(context.client.clientId);
  if (
    !isJsonObject(body) ||
    !isConsumerResourceScope(body) ||
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
