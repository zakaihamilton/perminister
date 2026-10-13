import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { consumerServiceError, requireConsumerJsonRequest } from "@/lib/auth/consumer-route";
import { isOrganizationId } from "@/lib/auth/consumer-policy";
import { bootstrapWorkspaceAdmin } from "@/lib/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await requireConsumerJsonRequest(request, 4096);
  if (parsed instanceof Response) return parsed;
  const { body, ...auth } = parsed;
  if (
    !isJsonObject(body) ||
    !isOrganizationId(body.organizationId) ||
    !isOrganizationId(body.workspaceId)
  ) {
    return Response.json(
      { error: "Provide a valid organizationId and workspaceId." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    await bootstrapWorkspaceAdmin(
      auth.current.subject.subjectId,
      auth.client.productId,
      body.organizationId.toLowerCase(),
      body.workspaceId.toLowerCase(),
    );
    return Response.json({ granted: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Workspace access could not be provisioned.");
  }
}
