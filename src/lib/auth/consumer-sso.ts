import type { ConsumerClientRecord } from "./domain";

export const CONSUMER_SSO_CALLBACK_PATH = "/auth/perminister/callback";
export const CONSUMER_OIDC_SCOPE = "openid profile email perminister_api";
export const LEGACY_CONSUMER_OAUTH_FLAG = "PERMINISTER_ENABLE_LEGACY_CONSUMER_OAUTH";
const LEGACY_CONSUMER_OAUTH_PRODUCT_IDS = new Set(["nanogres", "visitoring"]);

export type ConsumerAuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  responseType: "code";
  state: string;
  nonce: string | null;
  scope: typeof CONSUMER_OIDC_SCOPE | null;
  prompt: "login" | null;
  codeChallenge: string;
};

export function legacyConsumerAuthorizationEnabled(): boolean {
  return process.env[LEGACY_CONSUMER_OAUTH_FLAG] === "true";
}

export function parseConsumerAuthorizationRequest(
  params: URLSearchParams,
  client?: ConsumerClientRecord | null,
  options: { allowLegacy?: boolean } = {},
): ConsumerAuthorizationRequest | null {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = params.get("response_type");
  const state = params.get("state") ?? "";
  const nonce = params.get("nonce") ?? "";
  const scope = params.get("scope") ?? "";
  const prompt = params.get("prompt") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const challengeMethod = params.get("code_challenge_method");
  const hasNonce = params.has("nonce");
  const hasScope = params.has("scope");
  const legacyRequest =
    options.allowLegacy === true &&
    LEGACY_CONSUMER_OAUTH_PRODUCT_IDS.has(client?.productId.trim().toLowerCase() ?? "") &&
    !hasNonce &&
    !hasScope;
  const oidcRequest =
    hasNonce &&
    hasScope &&
    /^[A-Za-z0-9_-]{43}$/.test(nonce) &&
    scope === CONSUMER_OIDC_SCOPE;

  if (
    ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method"]
      .some((name) => params.getAll(name).length !== 1) ||
    params.getAll("nonce").length > 1 ||
    params.getAll("scope").length > 1 ||
    (params.has("prompt") && params.getAll("prompt").length !== 1) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId) ||
    responseType !== "code" ||
    challengeMethod !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    (!legacyRequest && !oidcRequest) ||
    (params.has("prompt") && prompt !== "login") ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
    redirectUri.length > 2048
  ) {
    return null;
  }

  let callback: URL;
  try {
    callback = new URL(redirectUri);
  } catch {
    return null;
  }
  const appOrigin = client?.appOrigin;
  let expectedRedirectUri = "";
  try {
    if (appOrigin) expectedRedirectUri = new URL(CONSUMER_SSO_CALLBACK_PATH, appOrigin).toString();
  } catch {
    return null;
  }
  if (
    client?.status !== "active" ||
    !expectedRedirectUri ||
    callback.toString() !== expectedRedirectUri ||
    callback.username ||
    callback.password
  ) {
    return null;
  }

  return {
    clientId: client.consumerClientId,
    redirectUri: callback.toString(),
    responseType: "code",
    state,
    nonce: legacyRequest ? null : nonce,
    scope: legacyRequest ? null : CONSUMER_OIDC_SCOPE,
    prompt: params.has("prompt") ? "login" : null,
    codeChallenge,
  };
}

export function consumerAuthorizationQuery(request: ConsumerAuthorizationRequest): string {
  const query = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: request.responseType,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
  });
  if (request.nonce && request.scope) {
    query.set("scope", request.scope);
    query.set("nonce", request.nonce);
  }
  if (request.prompt) query.set("prompt", request.prompt);
  return query.toString();
}

export function consumerAuthorizationErrorCallback(
  request: ConsumerAuthorizationRequest,
  error: "access_denied",
): string {
  const destination = new URL(request.redirectUri);
  destination.searchParams.set("error", error);
  destination.searchParams.set("state", request.state);
  return destination.toString();
}

export function safeConsumerAuthorizationReturnTo(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://perminister.invalid");
    if (url.origin !== "https://perminister.invalid" || url.pathname !== "/oauth/authorize") {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
