import { authenticateConsumerClientBasic } from "@/lib/auth/consumer-clients";
import { withApiRoutePerformance } from "@/lib/auth/performance";
import { getSessionFromToken } from "@/lib/auth/service";
import { NO_STORE_HEADERS, readBoundedRequestBody } from "@/lib/auth/http";
import { getOidcIssuer } from "@/lib/auth/oidc";
import { normalizeOAuthUri } from "@/lib/auth/oauth-uris";

export const runtime = "nodejs";

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      ...(status === 401 ? { "WWW-Authenticate": 'Basic realm="Perminister token introspection"' } : {}),
    },
  });
}

function uniqueValue(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

export const POST = withApiRoutePerformance(
  "POST /oauth/introspect",
  async function POST(request: Request): Promise<Response> {
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded" ||
      request.headers.has("x-perminister-client-id") ||
      request.headers.has("x-perminister-client-secret") ||
      new URL(request.url).search
    ) {
      return response({ error: "invalid_request" }, 400);
    }
    let body: URLSearchParams;
    try {
      body = new URLSearchParams(new TextDecoder().decode(await readBoundedRequestBody(request, 8 * 1024)));
    } catch {
      return response({ error: "invalid_request" }, 400);
    }
    if (
      body.getAll("token").length !== 1 ||
      body.has("client_id") ||
      body.has("client_secret")
    ) {
      return response({ error: "invalid_request" }, 400);
    }
    let client;
    try {
      client = await authenticateConsumerClientBasic(request);
    } catch {
      return response({ error: "temporarily_unavailable" }, 503);
    }
    if (!client) return response({ error: "invalid_client" }, 401);
    const token = uniqueValue(body, "token") ?? "";
    const suppliedResource = uniqueValue(body, "resource");
    let resource: string | null = null;
    try {
      if (suppliedResource) resource = normalizeOAuthUri(suppliedResource, "resource URI");
    } catch {
      return response({ error: "invalid_request" }, 400);
    }
    if (
      body.getAll("resource").length > 1 ||
      (body.has("resource") && !suppliedResource) ||
      token.length > 256
    ) {
      return response({ error: "invalid_request" }, 400);
    }
    try {
      const current = await getSessionFromToken(token);
      const session = current?.session;
      const scopes = session?.oauthScopes ?? [];
      const active = Boolean(
        session &&
          session.resource &&
          scopes.length &&
          session.applicationClientId === client.clientId &&
          session.productId === client.productId &&
          client.resourceUris.includes(session.resource) &&
          scopes.every((scope) => client.oauthScopes.includes(scope)) &&
          (!resource || session.resource === resource),
      );
      if (!active || !session || !current) return response({ active: false });
      const issuedAt = Math.floor(Date.parse(session.createdAt) / 1000);
      const expiresAt = Math.floor(Date.parse(session.expiresAt) / 1000);
      return response({
        active: true,
        scope: session.oauthGrantScope ?? session.oauthScopes?.join(" ") ?? "",
        client_id: session.oauthClientId ?? client.clientId,
        sub: current.subject.subjectId,
        aud: session.resource ? [session.resource] : [],
        iss: getOidcIssuer(),
        iat: issuedAt,
        exp: expiresAt,
        token_type: "Bearer",
      });
    } catch {
      return response({ error: "temporarily_unavailable" }, 503);
    }
  },
);
