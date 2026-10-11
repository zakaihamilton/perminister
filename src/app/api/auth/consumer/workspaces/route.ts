import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { consumerServiceError, requireConsumerJsonRequest } from "@/lib/auth/consumer-route";
import { isOrganizationId } from "@/lib/auth/consumer-policy";
import { bootstrapVisitoringWorkspaceAdmin } from "@/lib/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await requireConsumerJsonRequest(request, 4096);
  if (parsed instanceof Response) return parsed;
  const { body, ...auth } = parsed;
  if (
    auth.client.productId !== "visitoring" ||
    !isJsonObject(body) ||
    !isOrganizationId(body.organizationId) ||
    !isOrganizationId(body.workspaceId)
  ) {
    return Response.json(
      { error: "Provide a valid Visitoring organizationId and workspaceId." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    await bootstrapVisitoringWorkspaceAdmin(
      auth.current.subject.subjectId,
      body.organizationId.toLowerCase(),
      body.workspaceId.toLowerCase(),
    );
    return Response.json({ granted: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Workspace access could not be provisioned.");
  }
}
