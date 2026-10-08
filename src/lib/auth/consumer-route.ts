import "server-only";

import { authenticateConsumerClient, type ConsumerClient } from "./consumer-clients";
import { isOrganizationId } from "./consumer-policy";
import {
  bearerToken,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "./http";
import { getConsumerSessionFromToken, type AuthenticatedSession } from "./service";

export interface ConsumerRequestContext {
  client: ConsumerClient;
  current: AuthenticatedSession;
}

export async function readConsumerJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown | Response> {
  if (!isJsonRequest(request)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: NO_STORE_HEADERS },
    );
  }
  try {
    return await readBoundedJson(request, maxBytes);
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
}

export async function consumerRequestContext(
  request: Request,
): Promise<ConsumerRequestContext | Response | null> {
  try {
    const client = await authenticateConsumerClient(request);
    const token = bearerToken(request);
    if (!client || !token) return null;
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

export async function requireConsumerRequestContext(
  request: Request,
): Promise<ConsumerRequestContext | Response> {
  const context = await consumerRequestContext(request);
  if (context instanceof Response) return context;
  return context ?? authenticationRequired();
}

export async function requireConsumerJsonRequest(
  request: Request,
  maxBytes: number,
): Promise<(ConsumerRequestContext & { body: unknown }) | Response> {
  const context = await requireConsumerRequestContext(request);
  if (context instanceof Response) return context;
  const body = await readConsumerJsonBody(request, maxBytes);
  if (body instanceof Response) return body;
  return { ...context, body };
}

export async function requireConsumerClient(request: Request): Promise<ConsumerClient | Response> {
  let client: ConsumerClient | null;
  try {
    client = await authenticateConsumerClient(request);
  } catch {
    return Response.json(
      { error: "Authentication service is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (client) return client;
  return Response.json(
    { error: "Invalid application credentials." },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

export async function requireConsumerClientJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ client: ConsumerClient; body: unknown } | Response> {
  const client = await requireConsumerClient(request);
  if (client instanceof Response) return client;
  const body = await readConsumerJsonBody(request, maxBytes);
  if (body instanceof Response) return body;
  return { client, body };
}

export function consumerIntegrationError(
  error: unknown,
  notFoundMessage: string,
  fallback: string,
): Response {
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
            ? notFoundMessage
            : fallback,
    },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function invalidConsumerEmailResponse(): Response {
  return Response.json(
    { error: "Provide a valid email address." },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

export function organizationIdFromRequest(request: Request): string | Response {
  const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
  if (isOrganizationId(organizationId)) return organizationId.toLowerCase();
  return Response.json(
    { error: "Provide a valid organizationId." },
    { status: 400, headers: NO_STORE_HEADERS },
  );
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
