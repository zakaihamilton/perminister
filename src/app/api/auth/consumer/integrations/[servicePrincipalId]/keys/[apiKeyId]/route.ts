import { NO_STORE_HEADERS } from "@/lib/auth/http";
import { requireConsumerRequestContext } from "@/lib/auth/consumer-route";
import { revokeServicePrincipalApiKey } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ servicePrincipalId: string; apiKeyId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireConsumerRequestContext(request);
  if (auth instanceof Response) return auth;
  const { client, current } = auth;
  const { servicePrincipalId, apiKeyId } = await context.params;
  try {
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
