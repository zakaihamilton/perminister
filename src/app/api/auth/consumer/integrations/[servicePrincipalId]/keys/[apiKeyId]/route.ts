import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import { bearerToken, NO_STORE_HEADERS } from "@/lib/auth/http";
import { getConsumerSessionFromToken, revokeServicePrincipalApiKey } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ servicePrincipalId: string; apiKeyId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
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
  const { servicePrincipalId, apiKeyId } = await context.params;
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
    await revokeServicePrincipalApiKey(
      current.subject.subjectId,
      servicePrincipalId,
      apiKeyId,
      client.productId,
    );
    return Response.json({ revoked: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("permission") ? 403 : message.includes("not found") ? 404 : 503;
    return Response.json(
      {
        error:
          status === 403
            ? "You cannot manage this integration."
            : status === 404
              ? "Integration key not found."
              : "Integration key service is temporarily unavailable.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
