import { withApiRoutePerformance } from "@/lib/auth/performance";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { consumerServiceError, requireConsumerJsonRequest } from "@/lib/auth/consumer-route";
import { isConsumerResourceId, isOrganizationId } from "@/lib/auth/consumer-policy";
import { bootstrapProjectAdmin } from "@/lib/auth/service";

export const runtime = "nodejs";

export const POST = withApiRoutePerformance(
  "POST /api/auth/consumer/projects",
  async function POST(request: Request) {
    const parsed = await requireConsumerJsonRequest(request, 4096);
    if (parsed instanceof Response) return parsed;
    const { body, ...auth } = parsed;
    if (
      !isJsonObject(body) ||
      !isOrganizationId(body.organizationId) ||
      !isConsumerResourceId(body.projectId)
    ) {
      return Response.json(
        { error: "Provide a valid organizationId and projectId." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    try {
      await bootstrapProjectAdmin(
        auth.current.subject.subjectId,
        auth.client.productId,
        body.organizationId.toLowerCase(),
        body.projectId.toLowerCase(),
      );
      return Response.json({ granted: true }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      return consumerServiceError(error, "Project access could not be provisioned.");
    }
  },
);
