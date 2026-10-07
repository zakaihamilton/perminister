import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { consumerIntegrationError, requireConsumerJsonRequest } from "@/lib/auth/consumer-route";
import { updateServicePrincipalStatus } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ servicePrincipalId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const parsed = await requireConsumerJsonRequest(request, 8 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, client, current } = parsed;
  if (!isJsonObject(body) || (body.status !== "active" && body.status !== "disabled")) {
    return Response.json(
      { error: "Provide status active or disabled." },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }
  const { servicePrincipalId } = await context.params;
  try {
    await updateServicePrincipalStatus(
      current.subject.subjectId,
      servicePrincipalId,
      body.status,
      client.productId,
    );
    return Response.json({ updated: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerIntegrationError(
      error,
      "Integration not found.",
      "Integration service is temporarily unavailable.",
    );
  }
}
