import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { consumerServiceError, requireConsumerJsonRequest } from "@/lib/auth/consumer-route";
import { isOrganizationId } from "@/lib/auth/consumer-policy";
import { revokeVisitoringWorkspaceGrants } from "@/lib/auth/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const parsed = await requireConsumerJsonRequest(request, 4096);
  if (parsed instanceof Response) return parsed;
  const { body, ...auth } = parsed;
  const { workspaceId } = await context.params;
  if (
    auth.client.productId !== "visitoring" ||
    !isOrganizationId(workspaceId) ||
    !isJsonObject(body) ||
    !isOrganizationId(body.organizationId)
  ) {
    return Response.json(
      { error: "Provide a valid Visitoring organizationId and workspaceId." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    await revokeVisitoringWorkspaceGrants(
      auth.current.subject.subjectId,
      body.organizationId.toLowerCase(),
      workspaceId.toLowerCase(),
    );
    return Response.json({ revoked: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Workspace access could not be revoked.");
  }
}
