import { withApiRoutePerformance } from "@/lib/auth/performance";
import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import { bearerToken, NO_STORE_HEADERS } from "@/lib/auth/http";
import {
  getSessionFromToken,
  listConsumerOrganizationsForSubject,
  revokeSession,
} from "@/lib/auth/service";

export const runtime = "nodejs";

type ConsumerSessionContext = {
  token: string | null;
  client: NonNullable<Awaited<ReturnType<typeof authenticateConsumerClient>>>;
  current: Awaited<ReturnType<typeof getSessionFromToken>>;
};

async function getConsumerSessionContext(
  request: Request,
): Promise<ConsumerSessionContext | Response> {
  const token = bearerToken(request);
  let client: Awaited<ReturnType<typeof authenticateConsumerClient>>;
  let current: Awaited<ReturnType<typeof getSessionFromToken>>;
  try {
    [client, current] = await Promise.all([
      authenticateConsumerClient(request),
      token ? getSessionFromToken(token) : Promise.resolve(null),
    ]);
  } catch {
    return Response.json(
      { error: "Session service is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (!client) {
    return Response.json(
      { error: "Invalid application credentials." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  return { token, client, current };
}

export const GET = withApiRoutePerformance(
  "GET /api/auth/consumer/session",
  async function GET(request: Request) {
    const context = await getConsumerSessionContext(request);
    if (context instanceof Response) return context;
    const { token, client, current } = context;
    if (!token) {
      return Response.json({ authenticated: false }, { status: 401, headers: NO_STORE_HEADERS });
    }
    try {
      if (
        !current ||
        current.session.applicationClientId !== client.clientId ||
        current.session.productId !== client.productId
      ) {
        return Response.json({ authenticated: false }, { status: 401, headers: NO_STORE_HEADERS });
      }
      const organizations = await listConsumerOrganizationsForSubject(
        current.subject.subjectId,
        client.productId,
      );
      return Response.json(
        {
          authenticated: true,
          account: {
            subjectId: current.subject.subjectId,
            email: current.subject.primaryEmail,
            username:
              current.subject.loginIdentifiers?.find((item) => item.productId === client.productId)
                ?.value ?? null,
            firstName: current.subject.firstName ?? null,
            lastName: current.subject.lastName ?? null,
          },
          session: {
            createdAt: current.session.createdAt,
            expiresAt: current.session.expiresAt,
          },
          organizations,
        },
        { headers: NO_STORE_HEADERS },
      );
    } catch {
      return Response.json(
        { error: "Session service is temporarily unavailable." },
        {
          status: 503,
          headers: NO_STORE_HEADERS,
        },
      );
    }
  },
);

export const DELETE = withApiRoutePerformance(
  "DELETE /api/auth/consumer/session",
  async function DELETE(request: Request) {
    const context = await getConsumerSessionContext(request);
    if (context instanceof Response) return context;
    const { client, current } = context;
    if (
      current &&
      current.session.applicationClientId === client.clientId &&
      current.session.productId === client.productId
    ) {
      try {
        await revokeSession(current.session.sessionId, current.subject.subjectId);
      } catch {
        return Response.json(
          { error: "Session service is temporarily unavailable." },
          {
            status: 503,
            headers: NO_STORE_HEADERS,
          },
        );
      }
    }
    return Response.json({ signedOut: true }, { headers: NO_STORE_HEADERS });
  },
);
