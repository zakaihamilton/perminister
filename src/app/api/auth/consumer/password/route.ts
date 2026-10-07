import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import {
  bearerToken,
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import { changePasswordForSubject, getConsumerSessionFromToken } from "@/lib/auth/service";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
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
  if (
    !isJsonObject(body) ||
    typeof body.currentPassword !== "string" ||
    typeof body.newPassword !== "string" ||
    body.currentPassword.length > 256 ||
    body.newPassword.length < 15 ||
    body.newPassword.length > 256
  ) {
    return Response.json(
      { error: "Provide the current password and a new password between 15 and 256 characters." },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }
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
    await changePasswordForSubject(
      current.subject.subjectId,
      body.currentPassword,
      body.newPassword,
    );
    return Response.json(
      { passwordChanged: true, allSessionsRevoked: true },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password could not be changed.";
    const status = message === "Current password is incorrect." ? 403 : 503;
    return Response.json(
      {
        error:
          status === 403
            ? "current_password_incorrect"
            : "Password change is temporarily unavailable.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
