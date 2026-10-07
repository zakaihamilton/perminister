import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import { bearerToken, NO_STORE_HEADERS } from "@/lib/auth/http";
import {
  getConsumerSessionFromToken,
  listConsumerOrganizationsForSubject,
  revokeConsumerSession,
} from "@/lib/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
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
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ authenticated: false }, { status: 401, headers: NO_STORE_HEADERS });
  }
  try {
    const current = await getConsumerSessionFromToken(token, client.clientId);
    if (!current || current.session.productId !== client.productId) {
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
}

export async function DELETE(request: Request) {
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
  const token = bearerToken(request);
  if (token) {
    try {
      await revokeConsumerSession(token, client.clientId);
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
}
