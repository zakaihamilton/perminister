import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import {
  bearerToken,
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import { getConsumerSessionFromToken, updateServicePrincipalStatus } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ servicePrincipalId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
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
  if (!isJsonObject(body) || (body.status !== "active" && body.status !== "disabled")) {
    return Response.json(
      { error: "Provide status active or disabled." },
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
    await updateServicePrincipalStatus(
      current.subject.subjectId,
      servicePrincipalId,
      body.status,
      client.productId,
    );
    return Response.json({ updated: true }, { headers: NO_STORE_HEADERS });
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
            : status === 404
              ? "Integration not found."
              : "Integration service is temporarily unavailable.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
