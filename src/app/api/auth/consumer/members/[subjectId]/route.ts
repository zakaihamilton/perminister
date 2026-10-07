import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { consumerServiceError, requireConsumerJsonRequest } from "@/lib/auth/consumer-route";
import {
  consumerMemberScopeInput,
  consumerProductPolicy,
  isConsumerResourceScope,
} from "@/lib/auth/consumer-policy";
import { removeConsumerMember, updateConsumerMember } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ subjectId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const parsed = await requireConsumerJsonRequest(request, 16 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, ...auth } = parsed;
  const policy = consumerProductPolicy(auth.client.clientId);
  if (
    !isJsonObject(body) ||
    !isConsumerResourceScope(body) ||
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
      ...consumerMemberScopeInput(body, auth.client.productId),
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
  const parsed = await requireConsumerJsonRequest(request, 16 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, ...auth } = parsed;
  const policy = consumerProductPolicy(auth.client.clientId);
  if (
    !isJsonObject(body) ||
    !isConsumerResourceScope(body) ||
    !policy ||
    body.scopeKind !== policy.scopeKind
  ) {
    return Response.json(
      { error: "Provide a valid resource scope." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const { subjectId } = await context.params;
  try {
    await removeConsumerMember(auth.current.subject.subjectId, auth.client.clientId, subjectId, {
      ...consumerMemberScopeInput(body, auth.client.productId),
    });
    return Response.json({ removed: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Member service is temporarily unavailable.");
  }
}
