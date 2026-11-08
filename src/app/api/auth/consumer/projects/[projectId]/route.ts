import { withApiRoutePerformance } from "@/lib/auth/performance";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { consumerServiceError, requireConsumerJsonRequest } from "@/lib/auth/consumer-route";
import { isConsumerResourceId, isOrganizationId } from "@/lib/auth/consumer-policy";
import { revokeProjectGrants } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };

export const DELETE = withApiRoutePerformance(
  "DELETE /api/auth/consumer/projects/[projectId]",
  async function DELETE(request: Request, context: RouteContext) {
    const parsed = await requireConsumerJsonRequest(request, 4096);
    if (parsed instanceof Response) return parsed;
    const { body, ...auth } = parsed;
    const { projectId } = await context.params;
    if (
      !isConsumerResourceId(projectId) ||
      !isJsonObject(body) ||
      !isOrganizationId(body.organizationId)
    ) {
      return Response.json(
        { error: "Provide a valid organizationId and projectId." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    try {
      await revokeProjectGrants(
        auth.current.subject.subjectId,
        auth.client.productId,
        body.organizationId.toLowerCase(),
        projectId.toLowerCase(),
      );
      return Response.json({ revoked: true }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      return consumerServiceError(error, "Project access could not be revoked.");
    }
  },
);
