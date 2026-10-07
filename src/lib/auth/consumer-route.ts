import "server-only";

import { authenticateConsumerClient, type ConsumerClient } from "./consumer-clients";
import { bearerToken, NO_STORE_HEADERS } from "./http";
import { getConsumerSessionFromToken, type AuthenticatedSession } from "./service";

export interface ConsumerRequestContext {
  client: ConsumerClient;
  current: AuthenticatedSession;
}

export async function consumerRequestContext(
  request: Request,
): Promise<ConsumerRequestContext | Response | null> {
  const client = authenticateConsumerClient(request);
  const token = bearerToken(request);
  if (!client || !token) return null;
  try {
    const current = await getConsumerSessionFromToken(token, client.clientId);
    if (!current || current.session.productId !== client.productId) return null;
    return { client, current };
  } catch {
    return Response.json(
      { error: "Authentication service is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export function consumerServiceError(error: unknown, fallback: string): Response {
  const message = error instanceof Error ? error.message : "";
  const status = /permission|administrator|cannot|ask another/i.test(message)
    ? 403
    : /not found|does not exist/i.test(message)
      ? 404
      : /already|in use|different accounts|must keep|collision|disabled/i.test(message)
        ? 409
        : /valid|provide|choose|password|email|username|role|characters|unsupported|must be|uuid|identifier/i.test(
              message,
            )
          ? 400
          : 503;
  return Response.json(
    {
      error:
        status === 400 || status === 409
          ? message
          : status === 403
            ? "You do not have permission to perform this operation."
            : status === 404
              ? "The requested account or resource was not found."
              : fallback,
    },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function authenticationRequired(): Response {
  return Response.json(
    { error: "Authentication is required." },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}
