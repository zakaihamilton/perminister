import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { consumerServiceError, requireConsumerJsonRequest } from "@/lib/auth/consumer-route";
import { isOrganizationId } from "@/lib/auth/consumer-policy";
import { updateConsumerAccount } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ subjectId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const parsed = await requireConsumerJsonRequest(request, 16 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, ...auth } = parsed;
  if (
    !isJsonObject(body) ||
    !isOrganizationId(body.organizationId) ||
    (body.status !== undefined && body.status !== "active" && body.status !== "disabled") ||
    (body.password !== undefined && typeof body.password !== "string") ||
    (body.revokeSessions !== undefined && typeof body.revokeSessions !== "boolean") ||
    (body.platformAdmin !== undefined && typeof body.platformAdmin !== "boolean") ||
    (body.status === undefined &&
      body.password === undefined &&
      body.revokeSessions !== true &&
      body.platformAdmin === undefined)
  ) {
    return Response.json(
      {
        error:
          "Provide organizationId and a status, password, platform role, or session revocation change.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const { subjectId } = await context.params;
  try {
    await updateConsumerAccount(auth.current.subject.subjectId, auth.client.productId, subjectId, {
      organizationId: body.organizationId.toLowerCase(),
      productId: auth.client.productId,
      ...(body.status === "active" || body.status === "disabled" ? { status: body.status } : {}),
      ...(typeof body.password === "string" ? { password: body.password } : {}),
      ...(body.revokeSessions === true ? { revokeSessions: true } : {}),
      ...(typeof body.platformAdmin === "boolean" ? { platformAdmin: body.platformAdmin } : {}),
    });
    return Response.json({ updated: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Account service is temporarily unavailable.");
  }
}
