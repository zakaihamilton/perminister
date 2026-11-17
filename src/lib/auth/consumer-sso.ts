import type { ConsumerClientId, ConsumerClientRecord } from "./domain";
import type { ConsumerOAuthAuthorizationClient } from "./service/consumer-and-memberships";
import { normalizeOAuthUri } from "./oauth-uris";

export const CONSUMER_SSO_CALLBACK_PATH = "/auth/perminister/callback";
export const GOOGLE_LOGIN_CALLBACK_PATH = "/auth/google/callback";
export const CONSUMER_OIDC_SCOPE = "openid profile email perminister_api";
export const LEGACY_CONSUMER_OAUTH_FLAG = "PERMINISTER_ENABLE_LEGACY_CONSUMER_OAUTH";
const LEGACY_CONSUMER_OAUTH_PRODUCT_IDS = new Set(["nanogres", "visitoring"]);
const IDENTITY_SCOPES = new Set(["openid", "profile", "email", "perminister_api"]);

export type ConsumerAuthorizationRequest = {
  clientId: string;
  consumerClientId: ConsumerClientId;
  clientName: string;
  publicClient: boolean;
  redirectUri: string;
  resource: string | null;
  responseType: "code";
  state: string;
  nonce: string | null;
  scope: string | null;
  scopes: readonly string[];
  prompt: "login" | null;
  codeChallenge: string;
};

function authorizationClient(
  client: ConsumerOAuthAuthorizationClient | ConsumerClientRecord | null | undefined,
): ConsumerOAuthAuthorizationClient | null {
  if (!client) return null;
  if ("profile" in client) return client;
  let legacyRedirect: string | null = null;
  try {
    if (client.appOrigin) {
      legacyRedirect = new URL(CONSUMER_SSO_CALLBACK_PATH, client.appOrigin).toString();
    }
  } catch {
    return null;
  }
  return {
    oauthClientId: client.consumerClientId,
    oauthClientType: "confidential",
    clientName: client.appName,
    profile: client,
    redirectUris: client.redirectUris?.length
      ? client.redirectUris
      : legacyRedirect
        ? [legacyRedirect]
        : [],
    registrationScopes: null,
  };
}

export function legacyConsumerAuthorizationEnabled(): boolean {
  return process.env[LEGACY_CONSUMER_OAUTH_FLAG] === "true";
}

export function parseConsumerAuthorizationRequest(
  params: URLSearchParams,
  client?: ConsumerOAuthAuthorizationClient | ConsumerClientRecord | null,
  options: { allowLegacy?: boolean } = {},
): ConsumerAuthorizationRequest | null {
  const resolvedClient = authorizationClient(client);
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = params.get("response_type");
  const state = params.get("state") ?? "";
  const nonce = params.get("nonce") ?? "";
  const scope = params.get("scope") ?? "";
  const prompt = params.get("prompt") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const resource = params.get("resource") ?? "";
  const challengeMethod = params.get("code_challenge_method");
  const hasNonce = params.has("nonce");
  const hasScope = params.has("scope");
  const hasResource = params.has("resource");
  const scopeTokens = scope ? scope.split(" ") : [];
  const legacyRequest =
    options.allowLegacy === true &&
    LEGACY_CONSUMER_OAUTH_PRODUCT_IDS.has(
      resolvedClient?.profile.productId.trim().toLowerCase() ?? "",
    ) &&
    !hasNonce &&
    !hasScope;
  const oidcRequest =
    hasNonce &&
    hasScope &&
    /^[A-Za-z0-9_-]{43}$/.test(nonce) &&
    scope === CONSUMER_OIDC_SCOPE;
  const hasIdentityScopes = scopeTokens.some((item) => IDENTITY_SCOPES.has(item));
  const resourceScopeShape =
    hasResource &&
    hasScope &&
    scope.length <= 2048 &&
    scopeTokens.length > 0 &&
    new Set(scopeTokens).size === scopeTokens.length &&
    scopeTokens.every((item) => /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(item)) &&
    (hasNonce
      ? hasIdentityScopes && scopeTokens.includes("openid") && /^[A-Za-z0-9_-]{43}$/.test(nonce)
      : !hasIdentityScopes);

  if (
    ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method"]
      .some((name) => params.getAll(name).length !== 1) ||
    params.getAll("nonce").length > 1 ||
    params.getAll("scope").length > 1 ||
    params.getAll("resource").length > 1 ||
    (params.has("prompt") && params.getAll("prompt").length !== 1) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId) ||
    responseType !== "code" ||
    challengeMethod !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    (!legacyRequest && !oidcRequest && !resourceScopeShape) ||
    (params.has("prompt") && prompt !== "login") ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
    redirectUri.length > 2048
  ) {
    return null;
  }

  let normalizedRedirectUri: string;
  let normalizedResource: string | null = null;
  try {
    normalizedRedirectUri = normalizeOAuthUri(redirectUri, "redirect URI");
    if (resource) normalizedResource = normalizeOAuthUri(resource, "resource URI");
  } catch {
    return null;
  }
  const allowedScopes = new Set(resolvedClient?.profile.oauthScopes ?? []);
  const registrationScopes = resolvedClient?.registrationScopes
    ? new Set(resolvedClient.registrationScopes)
    : null;
  const permissionScopes = scopeTokens.filter((item) => !IDENTITY_SCOPES.has(item));
  const isConfiguredResourceRequest =
    hasScope &&
    hasResource &&
    Boolean(normalizedResource) &&
    scopeTokens.length > 0 &&
    permissionScopes.length > 0 &&
    scopeTokens.every((item) => IDENTITY_SCOPES.has(item) || allowedScopes.has(item)) &&
    permissionScopes.every(
      (item, index) =>
        /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(item) &&
        permissionScopes.indexOf(item) === index &&
        (!registrationScopes || registrationScopes.has(item)),
    ) &&
    (!hasNonce || scopeTokens.includes("openid"));
  const expectedRedirectUris = resolvedClient?.redirectUris ?? [];
  if (
    !resolvedClient ||
    resolvedClient.profile.status !== "active" ||
    !expectedRedirectUris.includes(normalizedRedirectUri) ||
    (resolvedClient.oauthClientType === "confidential" &&
      resolvedClient.profile.resourceUris?.length &&
      !normalizedResource) ||
    (hasResource &&
      (!normalizedResource || !resolvedClient.profile.resourceUris?.includes(normalizedResource))) ||
    (hasScope && !oidcRequest && !isConfiguredResourceRequest) ||
    (hasNonce && !oidcRequest && !isConfiguredResourceRequest) ||
    (oidcRequest && resolvedClient.oauthClientType === "public" && !normalizedResource)
  ) {
    return null;
  }

  return {
    clientId: resolvedClient.oauthClientId,
    consumerClientId: resolvedClient.profile.consumerClientId,
    clientName: resolvedClient.clientName,
    publicClient: resolvedClient.oauthClientType === "public",
    redirectUri: normalizedRedirectUri,
    resource: normalizedResource,
    responseType: "code",
    state,
    nonce: legacyRequest || !hasNonce ? null : nonce,
    scope: legacyRequest ? null : hasScope ? scope : null,
    scopes: legacyRequest ? [] : scopeTokens,
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
    query.set("nonce", request.nonce);
  }
  if (request.scope) query.set("scope", request.scope);
  if (request.resource) query.set("resource", request.resource);
  if (request.prompt) query.set("prompt", request.prompt);
  return query.toString();
}

export function consumerAuthorizationErrorCallback(
  request: ConsumerAuthorizationRequest,
  error: "access_denied",
  issuer?: string,
): string {
  const destination = new URL(request.redirectUri);
  destination.searchParams.set("error", error);
  destination.searchParams.set("state", request.state);
  if (issuer) destination.searchParams.set("iss", issuer);
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
