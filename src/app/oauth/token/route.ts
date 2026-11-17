import { withApiRoutePerformance, withRequestPerformanceSpan } from "@/lib/auth/performance";
import { authenticateConsumerClientBasic } from "@/lib/auth/consumer-clients";
import { NO_STORE_HEADERS, noStoreJsonResponse, readBoundedRequestBody, uniqueFormValue } from "@/lib/auth/http";
import {
  exchangeConsumerAuthorizationCode,
  getOAuthClientRegistration,
  InvalidConsumerAuthorizationCodeError,
  InvalidConsumerAuthorizationScopeError,
} from "@/lib/auth/service";
import { assertOidcSigningKeyReady, signOidcIdToken } from "@/lib/auth/oidc";

export const runtime = "nodejs";

function invalidRequest(error: string, status = 400): Response {
  return noStoreJsonResponse({ error }, status, 'Basic realm="Perminister OIDC token endpoint"');
}

export const POST = withApiRoutePerformance(
  "POST /oauth/token",
  async function POST(request: Request): Promise<Response> {
    if (
      new URL(request.url).search ||
      request.headers.has("x-perminister-client-id") ||
      request.headers.has("x-perminister-client-secret")
    ) {
      return invalidRequest("invalid_request");
    }
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
    ) {
      return invalidRequest("invalid_request");
    }

    let body: URLSearchParams;
    try {
      const bytes = await readBoundedRequestBody(request, 8 * 1024);
      body = new URLSearchParams(new TextDecoder().decode(bytes));
    } catch {
      return invalidRequest("invalid_request");
    }

    const grantType = uniqueFormValue(body, "grant_type");
    const code = uniqueFormValue(body, "code");
    const verifier = uniqueFormValue(body, "code_verifier");
    const redirectUri = uniqueFormValue(body, "redirect_uri");
    const suppliedClientId = uniqueFormValue(body, "client_id");
    const resource = uniqueFormValue(body, "resource");
    const requestedScope = uniqueFormValue(body, "scope");
    if (
      grantType !== "authorization_code" ||
      !code ||
      !verifier ||
      !redirectUri ||
      body.getAll("grant_type").length !== 1 ||
      body.getAll("code").length !== 1 ||
      body.getAll("code_verifier").length !== 1 ||
      body.getAll("redirect_uri").length !== 1 ||
      body.has("client_secret") ||
      body.getAll("client_id").length > 1 ||
      body.getAll("resource").length > 1 ||
      body.getAll("scope").length > 1
    ) {
      return invalidRequest("invalid_request");
    }

    let oauthClientId: string | null = null;
    const authorizationHeader = request.headers.get("authorization");
    if (authorizationHeader) {
      let client;
      try {
        client = await withRequestPerformanceSpan("auth.oidc.client-authentication", () =>
          authenticateConsumerClientBasic(request),
        );
      } catch {
        return invalidRequest("temporarily_unavailable", 503);
      }
      if (!client) return invalidRequest("invalid_client", 401);
      oauthClientId = client.clientId;
    } else if (suppliedClientId) {
      let registration;
      try {
        registration = await withRequestPerformanceSpan("auth.oidc.public-client-lookup", () =>
          getOAuthClientRegistration(suppliedClientId),
        );
      } catch {
        return invalidRequest("temporarily_unavailable", 503);
      }
      if (!registration || registration.status !== "active") {
        return invalidRequest("invalid_client", 401);
      }
      oauthClientId = suppliedClientId;
    } else {
      return invalidRequest("invalid_client", 401);
    }
    if (body.has("client_id") && suppliedClientId !== oauthClientId) {
      return invalidRequest("invalid_client", 401);
    }

    try {
      const exchanged = await withRequestPerformanceSpan(
        "auth.oidc.authorization-code-exchange",
        () =>
          exchangeConsumerAuthorizationCode(
            code,
            oauthClientId!,
            verifier,
            redirectUri,
            resource,
            body.has("scope") ? requestedScope ?? "" : undefined,
            {
              requireOAuthTokenResponse: true,
              beforeConsume: ({ nonce }) => {
                if (nonce) assertOidcSigningKeyReady();
              },
            },
          ),
      );
      const nonce = exchanged.nonce;
      const expiresIn = Math.floor((Date.parse(exchanged.session.expiresAt) - Date.now()) / 1000);
      if (expiresIn <= 0) return invalidRequest("invalid_grant");
      const idToken = nonce
        ? await withRequestPerformanceSpan("auth.oidc.id-token-signing", async () => {
            return signOidcIdToken({
              clientId: oauthClientId!,
              nonce,
              scopes: exchanged.scope?.split(" ").filter(Boolean) ?? [],
              subject: exchanged.subject,
            });
          })
        : undefined;
      return Response.json(
        {
          access_token: exchanged.token,
          token_type: "Bearer",
          expires_in: expiresIn,
          scope: exchanged.scope,
          ...(idToken ? { id_token: idToken } : {}),
        },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      if (error instanceof InvalidConsumerAuthorizationCodeError) {
        return invalidRequest("invalid_grant");
      }
      if (error instanceof InvalidConsumerAuthorizationScopeError) {
        return invalidRequest("invalid_scope");
      }
      return invalidRequest("temporarily_unavailable", 503);
    }
  },
);
