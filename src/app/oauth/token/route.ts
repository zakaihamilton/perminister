import { withApiRoutePerformance } from "@/lib/auth/performance";
import { authenticateConsumerClientBasic } from "@/lib/auth/consumer-clients";
import { NO_STORE_HEADERS, readBoundedRequestBody } from "@/lib/auth/http";
import {
  exchangeConsumerAuthorizationCode,
  InvalidConsumerAuthorizationCodeError,
} from "@/lib/auth/service";
import { assertOidcSigningKeyReady, signOidcIdToken } from "@/lib/auth/oidc";

export const runtime = "nodejs";

function invalidRequest(error: string, status = 400): Response {
  return Response.json(
    { error },
    {
      status,
      headers: {
        ...NO_STORE_HEADERS,
        ...(status === 401
          ? { "WWW-Authenticate": 'Basic realm="Perminister OIDC token endpoint"' }
          : {}),
      },
    },
  );
}

function uniqueValue(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] ?? null : null;
}

export const POST = withApiRoutePerformance(
  "POST /oauth/token",
  async function POST(request: Request): Promise<Response> {
    if (new URL(request.url).search || request.headers.has("x-perminister-client-id") || request.headers.has("x-perminister-client-secret")) {
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

    const grantType = uniqueValue(body, "grant_type");
    const code = uniqueValue(body, "code");
    const verifier = uniqueValue(body, "code_verifier");
    const redirectUri = uniqueValue(body, "redirect_uri");
    if (
      grantType !== "authorization_code" ||
      !code ||
      !verifier ||
      !redirectUri ||
      body.getAll("grant_type").length !== 1 ||
      body.getAll("code").length !== 1 ||
      body.getAll("code_verifier").length !== 1 ||
      body.getAll("redirect_uri").length !== 1
      || body.has("client_secret")
      || body.has("scope")
    ) {
      return invalidRequest("invalid_request");
    }

    let client;
    try {
      client = await authenticateConsumerClientBasic(request);
    } catch {
      return invalidRequest("temporarily_unavailable", 503);
    }
    if (!client) return invalidRequest("invalid_client", 401);
    const suppliedClientId = uniqueValue(body, "client_id");
    if (body.has("client_id") && suppliedClientId !== client.clientId) {
      return invalidRequest("invalid_client", 401);
    }

    try {
      assertOidcSigningKeyReady();
      const exchanged = await exchangeConsumerAuthorizationCode(
        code,
        client.clientId,
        verifier,
        redirectUri,
      );
      if (!exchanged.nonce || exchanged.scope !== "openid profile email perminister_api") {
        return invalidRequest("invalid_grant");
      }
      const expiresIn = Math.floor((Date.parse(exchanged.session.expiresAt) - Date.now()) / 1000);
      if (expiresIn <= 0) return invalidRequest("invalid_grant");
      const idToken = signOidcIdToken({
        clientId: client.clientId,
        nonce: exchanged.nonce,
        subject: exchanged.subject,
      });
      return Response.json(
        {
          access_token: exchanged.token,
          token_type: "Bearer",
          expires_in: expiresIn,
          scope: exchanged.scope,
          id_token: idToken,
        },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      if (error instanceof InvalidConsumerAuthorizationCodeError) {
        return invalidRequest("invalid_grant");
      }
      return invalidRequest("temporarily_unavailable", 503);
    }
  },
);
