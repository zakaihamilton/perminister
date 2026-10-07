import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import {
  bearerToken,
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import {
  createServicePrincipal,
  getConsumerSessionFromToken,
  listServicePrincipalsForOrganization,
} from "@/lib/auth/service";

export const runtime = "nodejs";

const organizationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
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
  const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
  if (!organizationIdPattern.test(organizationId)) {
    return Response.json(
      { error: "Provide a valid organizationId." },
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
    const integrations = await listServicePrincipalsForOrganization(
      current.subject.subjectId,
      organizationId,
      client.productId,
    );
    return Response.json({ integrations }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("permission")
      ? 403
      : message.includes("Organization not found")
        ? 404
        : 503;
    return Response.json(
      {
        error:
          status === 403
            ? "You cannot manage integrations in this organization."
            : status === 404
              ? "Organization not found."
              : "Integration service is temporarily unavailable.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function POST(request: Request) {
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
    typeof body.organizationId !== "string" ||
    !organizationIdPattern.test(body.organizationId) ||
    typeof body.name !== "string"
  ) {
    return Response.json(
      { error: "Provide organizationId and name." },
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
    const integration = await createServicePrincipal(
      current.subject.subjectId,
      body.organizationId,
      client.productId,
      body.name,
    );
    return Response.json({ integration }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Integration could not be created.";
    const status = message.includes("permission")
      ? 403
      : /not found|must be set up|choose a product/i.test(message)
        ? 404
        : /Integration names|Choose|valid|characters/i.test(message)
          ? 400
          : 503;
    return Response.json(
      {
        error:
          status === 403
            ? "You cannot manage integrations in this organization."
            : status === 400
              ? message
              : status === 404
                ? "The organization or product was not found."
                : "Integration service is temporarily unavailable.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
