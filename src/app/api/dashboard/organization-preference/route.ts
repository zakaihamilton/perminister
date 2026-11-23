import { getCurrentSession, listOrganizationsForSubject } from "@/lib/auth/service";
import { isJsonObject, isSameOriginBrowserRequest, NO_STORE_HEADERS } from "@/lib/auth/http";
import { rememberLastSelectedOrganization } from "@/lib/auth/organization-preference";

export const runtime = "nodejs";

function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginBrowserRequest(request)) return emptyResponse(403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return emptyResponse(400);
  }
  if (!isJsonObject(body) || typeof body.organizationId !== "string") {
    return emptyResponse(400);
  }
  const organizationId = body.organizationId;

  let current: Awaited<ReturnType<typeof getCurrentSession>>;
  try {
    current = await getCurrentSession();
  } catch {
    return emptyResponse(503);
  }
  if (!current) return emptyResponse(401);

  try {
    const organizations = await listOrganizationsForSubject(current.subject.subjectId);
    if (
      !organizations.some(
        ({ organization }) => organization.organizationId === organizationId,
      )
    ) {
      return emptyResponse(403);
    }

    await rememberLastSelectedOrganization(organizationId);
    return emptyResponse(204);
  } catch {
    return emptyResponse(503);
  }
}
