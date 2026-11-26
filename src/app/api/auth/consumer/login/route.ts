import { requireConsumerClientJsonBody } from "@/lib/auth/consumer-route";
import { passwordRecoveryRequesterKey } from "@/lib/auth/coordination";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { withApiRoutePerformance } from "@/lib/auth/performance";
import {
  isSentry8ConsumerClient,
  SENTRY8_PRODUCT_ID,
} from "@/lib/auth/sentry8-consumer";
import {
  authenticate,
  ConsumerProductAccessDeniedError,
  consumeConsumerLoginRequestRateLimit,
  createConsumerSession,
  isEmailVerifiedOrExemptForProduct,
  listConsumerOrganizationsForSubject,
} from "@/lib/auth/service";

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
    value.password.length <= 1024
  );
}

export const POST = withApiRoutePerformance(
  "POST /api/auth/consumer/login",
  async function POST(request: Request) {
    const parsed = await requireConsumerClientJsonBody(request, 8 * 1024);
    if (parsed instanceof Response) return parsed;
    const { body, client } = parsed;
    const isSentry8Product =
      client.productId.trim().toLowerCase() === SENTRY8_PRODUCT_ID;
    const isSentry8Client = isSentry8ConsumerClient(
      client.clientId,
      client.productId,
    );
    const passwordLoginEnabled = isSentry8Product
      ? isSentry8Client &&
        process.env.PERMINISTER_ENABLE_SENTRY8_CONSUMER_PASSWORD_LOGIN === "true"
      : process.env.PERMINISTER_ENABLE_LEGACY_CONSUMER_PASSWORD_LOGIN === "true";
    if (!passwordLoginEnabled) {
      return Response.json(
        { error: "Use the Perminister authorization-code sign-in flow." },
        { status: 410, headers: NO_STORE_HEADERS },
      );
    }
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
      if (
        !(await consumeConsumerLoginRequestRateLimit(
          client.clientId,
          passwordRecoveryRequesterKey(request.headers),
        ))
      ) {
        return Response.json(
          { error: "too_many_attempts" },
          { status: 429, headers: NO_STORE_HEADERS },
        );
      }
    } catch {
      return Response.json(
        { error: "Authentication is temporarily unavailable." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    try {
      const identifier = body.identifier ?? body.email!;
      const subject = await authenticate(identifier, body.password, client.productId);
      if (!isEmailVerifiedOrExemptForProduct(subject, client.productId)) {
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
              subject.loginIdentifiers?.find((item) => item.productId === client.productId)
                ?.value ?? null,
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
      if (error instanceof Error && error.message === "Email or password is incorrect.") {
        return Response.json(
          { error: "invalid_credentials" },
          {
            status: 401,
            headers: NO_STORE_HEADERS,
          },
        );
      }
      if (error instanceof ConsumerProductAccessDeniedError) {
        return Response.json(
          { error: "access_denied" },
          {
            status: 403,
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
  },
);
