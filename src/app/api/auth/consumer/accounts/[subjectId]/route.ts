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
import { updateConsumerAccount } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ subjectId: string }> };
const organizationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await consumerRequestContext(request);
  if (auth instanceof Response) return auth;
  if (!auth) return authenticationRequired();
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
  if (
    !isJsonObject(body) ||
    typeof body.organizationId !== "string" ||
    !organizationIdPattern.test(body.organizationId) ||
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
    await updateConsumerAccount(auth.current.subject.subjectId, auth.client.clientId, subjectId, {
      organizationId: body.organizationId,
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
