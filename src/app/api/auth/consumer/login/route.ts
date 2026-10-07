import {
  authenticate,
  createConsumerSession,
  listConsumerOrganizationsForSubject,
} from "@/lib/auth/service";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { requireConsumerClientJsonBody } from "@/lib/auth/consumer-route";

export const runtime = "nodejs";

function isLoginRequest(value: unknown): value is {
  email?: string;
  identifier?: string;
  password: string;
} {
  const identifier =
    typeof value === "object" && value !== null
      ? ((value as Record<string, unknown>).identifier ?? (value as Record<string, unknown>).email)
      : undefined;
  return (
    isJsonObject(value) &&
    typeof identifier === "string" &&
    identifier.length > 0 &&
    identifier.length <= 254 &&
    typeof value.password === "string" &&
    value.password.length > 0 &&
    value.password.length <= 256
  );
}

export async function POST(request: Request) {
  const parsed = await requireConsumerClientJsonBody(request, 8 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, client } = parsed;
  if (!isLoginRequest(body)) {
    return Response.json(
      { error: "Provide a login identifier and password." },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const identifier = body.identifier ?? body.email!;
    const subject = await authenticate(identifier, body.password, client.productId);
    if (subject.primaryEmail && !subject.emailVerifiedAt && !subject.emailVerificationExempt) {
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
      client.sessionLifetimeMs,
    );
    return Response.json(
      {
        authenticated: true,
        sessionToken: created.token,
        account: {
          subjectId: subject.subjectId,
          email: subject.primaryEmail,
          username:
            subject.loginIdentifiers?.find((item) => item.productId === client.productId)?.value ??
            null,
          loginIdentifier: identifier,
          firstName: subject.firstName ?? null,
          lastName: subject.lastName ?? null,
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
