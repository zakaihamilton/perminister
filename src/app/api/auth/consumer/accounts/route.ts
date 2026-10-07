import {
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import {
  authenticationRequired,
  consumerRequestContext,
  consumerServiceError,
} from "@/lib/auth/consumer-route";
import { createConsumerAccount, listConsumerAccounts } from "@/lib/auth/service";

export const runtime = "nodejs";

const organizationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await consumerRequestContext(request);
  if (auth instanceof Response) return auth;
  if (!auth) return authenticationRequired();
  const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
  if (!organizationIdPattern.test(organizationId)) {
    return Response.json(
      { error: "Provide a valid organizationId." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const accounts = await listConsumerAccounts(
      auth.current.subject.subjectId,
      auth.client.clientId,
      organizationId,
      auth.client.productId,
    );
    return Response.json({ accounts }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return consumerServiceError(error, "Account service is temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  const auth = await consumerRequestContext(request);
  if (auth instanceof Response) return auth;
  if (!auth) return authenticationRequired();
  if (!isJsonRequest(request)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: NO_STORE_HEADERS },
    );
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, 16 * 1024);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? "Request body is too large."
            : "Request body must be valid JSON.",
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: NO_STORE_HEADERS },
    );
  }
  if (
    !isJsonObject(body) ||
    typeof body.organizationId !== "string" ||
    !organizationIdPattern.test(body.organizationId) ||
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
      auth.client.clientId,
      {
        organizationId: body.organizationId,
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
