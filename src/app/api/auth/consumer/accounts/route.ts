import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import {
  requireConsumerRequestContext,
  consumerServiceError,
  organizationIdFromRequest,
  requireConsumerJsonRequest,
} from "@/lib/auth/consumer-route";
import { isOrganizationId } from "@/lib/auth/consumer-policy";
import { createConsumerAccount, listConsumerAccounts } from "@/lib/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireConsumerRequestContext(request);
  if (auth instanceof Response) return auth;
  const organizationId = organizationIdFromRequest(request);
  if (organizationId instanceof Response) return organizationId;
  try {
    const accounts = await listConsumerAccounts(
      auth.current.subject.subjectId,
      auth.client.productId,
      organizationId,
      auth.client.productId,
    );
    return Response.json({ accounts }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Account service is temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  const parsed = await requireConsumerJsonRequest(request, 16 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, ...auth } = parsed;
  if (
    !isJsonObject(body) ||
    !isOrganizationId(body.organizationId) ||
    typeof body.username !== "string" ||
    typeof body.password !== "string" ||
    (body.email !== undefined && typeof body.email !== "string") ||
    (body.platformAdmin !== undefined && typeof body.platformAdmin !== "boolean")
  ) {
    return Response.json(
      { error: "Provide organizationId, username, password, and an optional email." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const result = await createConsumerAccount(
      auth.current.subject.subjectId,
      auth.client.productId,
      {
        organizationId: body.organizationId.toLowerCase(),
        productId: auth.client.productId,
        username: body.username,
        email: body.email as string | undefined,
        password: body.password,
        platformAdmin: body.platformAdmin as boolean | undefined,
      },
    );
    return Response.json(result, { status: result.created ? 201 : 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Account service is temporarily unavailable.");
  }
}
