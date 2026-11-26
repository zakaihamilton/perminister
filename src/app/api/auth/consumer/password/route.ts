import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import {
  bearerToken,
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  RequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/auth/http";
import { withApiRoutePerformance } from "@/lib/auth/performance";
import { isSentry8ConsumerClient } from "@/lib/auth/sentry8-consumer";
import {
  changePasswordForSubject,
  createConsumerSession,
  getConsumerSessionFromToken,
} from "@/lib/auth/service";

export const runtime = "nodejs";

export const PATCH = withApiRoutePerformance(
  "PATCH /api/auth/consumer/password",
  async function PATCH(request: Request) {
    let client: Awaited<ReturnType<typeof authenticateConsumerClient>>;
    try {
      client = await authenticateConsumerClient(request);
    } catch {
      return Response.json(
        { error: "Authentication service is temporarily unavailable." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
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
    const sentry8Client = isSentry8ConsumerClient(
      client.clientId,
      client.productId,
    );
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
        {
          status: error instanceof RequestBodyTooLargeError ? 413 : 400,
          headers: NO_STORE_HEADERS,
        },
      );
    }
    if (
      !isJsonObject(body) ||
      typeof body.currentPassword !== "string" ||
      typeof body.newPassword !== "string" ||
      body.currentPassword.length > 256 ||
      body.newPassword.length < (sentry8Client ? 8 : 15) ||
      body.newPassword.length > 256
    ) {
      return Response.json(
        {
          error: `Provide the current password and a new password between ${sentry8Client ? 8 : 15} and 256 characters.`,
        },
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
        { minimumLength: sentry8Client ? 8 : 15 },
      );
      if (sentry8Client) {
        const refreshed = await createConsumerSession(
          current.subject.subjectId,
          client.clientId,
          client.productId,
          client.sessionLifetimeMs,
        );
        return Response.json(
          {
            passwordChanged: true,
            allSessionsRevoked: true,
            sessionToken: refreshed.token,
            session: { expiresAt: refreshed.session.expiresAt },
          },
          { headers: NO_STORE_HEADERS },
        );
      }
      return Response.json(
        { passwordChanged: true, allSessionsRevoked: true },
        {
          headers: NO_STORE_HEADERS,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Password could not be changed.";
      const status =
        message === "Current password is incorrect."
          ? 403
          : message === "Choose a different password from your current one."
            ? 400
            : 503;
      return Response.json(
        {
          error:
            status === 403
              ? "current_password_incorrect"
              : status === 400
                ? "same_password"
                : "Password change is temporarily unavailable.",
        },
        {
          status,
          headers: NO_STORE_HEADERS,
        },
      );
    }
  },
);
