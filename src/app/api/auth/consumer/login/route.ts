import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import {
  authenticate,
  createConsumerSession,
  listConsumerOrganizationsForSubject,
} from "@/lib/auth/service";
import {
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";

export const runtime = "nodejs";

function isLoginRequest(value: unknown): value is { email: string; password: string } {
  return (
    isJsonObject(value) &&
    typeof value.email === "string" &&
    value.email.length <= 254 &&
    typeof value.password === "string" &&
    value.password.length > 0 &&
    value.password.length <= 256
  );
}

export async function POST(request: Request) {
  const client = authenticateConsumerClient(request);
  if (!client) {
    return Response.json(
      { error: "Invalid application credentials." },
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
  if (!isLoginRequest(body)) {
    return Response.json(
      { error: "Provide an email address and password." },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const subject = await authenticate(body.email, body.password);
    if (!subject.emailVerifiedAt) {
      return Response.json(
        { error: "email_verification_required" },
        {
          status: 403,
          headers: NO_STORE_HEADERS,
        },
      );
    }
    const organizations = await listConsumerOrganizationsForSubject(
      subject.subjectId,
      client.productId,
    );
    const created = await createConsumerSession(
      subject.subjectId,
      client.clientId,
      client.productId,
    );
    return Response.json(
      {
        authenticated: true,
        sessionToken: created.token,
        account: {
          subjectId: subject.subjectId,
          email: subject.primaryEmail,
        },
        session: {
          expiresAt: created.session.expiresAt,
        },
        organizations,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Too many sign-in attempts")) {
      return Response.json(
        { error: "too_many_attempts" },
        {
          status: 429,
          headers: NO_STORE_HEADERS,
        },
      );
    }
    if (error instanceof Error && error.message === "Email or password is incorrect.") {
      return Response.json(
        { error: "invalid_credentials" },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        },
      );
    }
    return Response.json(
      { error: "Authentication is temporarily unavailable." },
      {
        status: 503,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
