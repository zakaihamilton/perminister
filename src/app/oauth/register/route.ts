import { passwordRecoveryRequesterKey } from "@/lib/auth/coordination";
import { isJsonRequest, NO_STORE_HEADERS, RequestBodyTooLargeError, readBoundedJson } from "@/lib/auth/http";
import { normalizeOAuthUriList, parseOAuthScopeList } from "@/lib/auth/oauth-uris";
import { withApiRoutePerformance } from "@/lib/auth/performance";
import { consumeOAuthClientRegistrationRateLimit, registerOAuthClient } from "@/lib/auth/service";

export const runtime = "nodejs";

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as string[];
}

export const POST = withApiRoutePerformance(
  "POST /oauth/register",
  async function POST(request: Request): Promise<Response> {
    if (!isJsonRequest(request)) return response({ error: "invalid_client_metadata" }, 415);
    let body: unknown;
    try {
      body = await readBoundedJson(request, 8 * 1024);
    } catch (error) {
      return response({ error: "invalid_client_metadata" }, error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return response({ error: "invalid_client_metadata" }, 400);
    }
    const metadata = body as Record<string, unknown>;
    const redirectUris = stringArray(metadata.redirect_uris);
    const grantTypes = metadata.grant_types === undefined ? ["authorization_code"] : stringArray(metadata.grant_types);
    const responseTypes = metadata.response_types === undefined ? ["code"] : stringArray(metadata.response_types);
    const clientName = typeof metadata.client_name === "string" ? metadata.client_name : "OAuth client";
    let scopes: string[] | undefined;
    try {
      if (typeof metadata.scope === "string") scopes = parseOAuthScopeList(metadata.scope);
    } catch {
      return response({ error: "invalid_client_metadata" }, 400);
    }
    if (
      !redirectUris?.length ||
      redirectUris.length > 20 ||
      !grantTypes || grantTypes.length !== 1 || grantTypes[0] !== "authorization_code" ||
      !responseTypes || responseTypes.length !== 1 || responseTypes[0] !== "code" ||
      (metadata.token_endpoint_auth_method !== undefined && metadata.token_endpoint_auth_method !== "none") ||
      (metadata.client_name !== undefined && typeof metadata.client_name !== "string") ||
      clientName.trim().length > 80 ||
      /[\u0000-\u001f\u007f]/.test(clientName) ||
      (metadata.scope !== undefined && typeof metadata.scope !== "string") ||
      metadata.client_id !== undefined ||
      metadata.client_secret !== undefined ||
      metadata.client_secret_expires_at !== undefined
    ) {
      return response({ error: "invalid_client_metadata" }, 400);
    }
    let normalizedRedirectUris: string[];
    try {
      normalizedRedirectUris = normalizeOAuthUriList(redirectUris, "redirect URIs");
    } catch {
      return response({ error: "invalid_redirect_uri" }, 400);
    }
    const callerKey = passwordRecoveryRequesterKey(request.headers);
    try {
      if (!(await consumeOAuthClientRegistrationRateLimit(callerKey))) {
        return response({ error: "temporarily_unavailable" }, 429);
      }
    } catch {
      return response({ error: "temporarily_unavailable" }, 503);
    }
    try {
      const registration = await registerOAuthClient(clientName, normalizedRedirectUris, scopes);
      return response(
        {
          client_id: registration.oauthClientId,
          client_id_issued_at: Math.floor(Date.parse(registration.createdAt) / 1000),
          client_name: registration.clientName,
          redirect_uris: registration.redirectUris,
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...(registration.scopes ? { scope: registration.scopes.join(" ") } : {}),
        },
        201,
      );
    } catch {
      return response({ error: "temporarily_unavailable" }, 503);
    }
  },
);
