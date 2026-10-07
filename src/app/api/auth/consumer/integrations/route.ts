import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import {
  organizationIdFromRequest,
  requireConsumerJsonRequest,
  requireConsumerRequestContext,
} from "@/lib/auth/consumer-route";
import { isOrganizationId } from "@/lib/auth/consumer-policy";
import { createServicePrincipal, listServicePrincipalsForOrganization } from "@/lib/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireConsumerRequestContext(request);
  if (auth instanceof Response) return auth;
  const { client, current } = auth;
  const organizationId = organizationIdFromRequest(request);
  if (organizationId instanceof Response) return organizationId;
  try {
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
  const parsed = await requireConsumerJsonRequest(request, 8 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, client, current } = parsed;
  if (
    !isJsonObject(body) ||
    !isOrganizationId(body.organizationId) ||
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
