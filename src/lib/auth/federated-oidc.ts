import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import {
  FederatedAccountLinkRequiredError,
  createSession,
  setSessionCookie,
  signInWithExternalIdentity,
} from "./service";
import { safeConsumerAuthorizationReturnTo } from "./consumer-sso";
import { NO_STORE_HEADERS, publicRedirectResponse } from "./http";
import { postLoginDestination } from "./login-redirect";

export const FEDERATED_OIDC_CALLBACK_PATH = "/auth/oidc/callback";
const OIDC_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const STATE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type ProviderConfiguration = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  providerKey: string;
};

type OidcMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type OidcLoginState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  providerKey: string;
  next: string | null;
  invitationToken: string;
};

type OidcIdentityClaims = {
  sub: string;
  email: string;
  email_verified: true;
  given_name?: string;
  family_name?: string;
};

function oidcStateCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-perminister_oidc_oauth"
    : "perminister_oidc_oauth";
}

function configuredProvider(): ProviderConfiguration | null {
  const issuer = process.env.PERMINISTER_LOGIN_OIDC_ISSUER?.trim();
  const clientId = process.env.PERMINISTER_LOGIN_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.PERMINISTER_LOGIN_OIDC_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    return null;
  }
  const localDevelopmentOrigin =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !localDevelopmentOrigin) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }
  return {
    issuer,
    clientId,
    clientSecret,
    providerKey: `oidc-${createHash("sha256").update(issuer).digest("hex").slice(0, 12)}`,
  };
}

export function federatedOidcLoginConfigured(): boolean {
  return configuredProvider() !== null;
}

export function federatedOidcLoginLabel(): string {
  return process.env.PERMINISTER_LOGIN_OIDC_NAME?.trim() || "Organization SSO";
}

function secureEndpoint(value: unknown): URL {
  if (typeof value !== "string") throw new Error("The identity provider metadata is invalid.");
  const endpoint = new URL(value);
  const localDevelopmentOrigin =
    process.env.NODE_ENV !== "production" &&
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !localDevelopmentOrigin) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error("The identity provider metadata must use HTTPS.");
  }
  return endpoint;
}

async function discoverProvider(configuration: ProviderConfiguration): Promise<OidcMetadata> {
  const issuer = new URL(configuration.issuer);
  const issuerPath = issuer.pathname.replace(/\/$/, "");
  const discoveryUrl = new URL(`${issuerPath}/.well-known/openid-configuration`, issuer.origin);
  const response = await fetch(discoveryUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("The identity provider could not be reached.");
  const document: unknown = await response.json();
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new Error("The identity provider metadata is invalid.");
  }
  const metadata = document as Partial<OidcMetadata>;
  if (metadata.issuer !== configuration.issuer) {
    throw new Error("The identity provider issuer does not match its configuration.");
  }
  secureEndpoint(metadata.authorization_endpoint);
  secureEndpoint(metadata.token_endpoint);
  secureEndpoint(metadata.jwks_uri);
  if (
    typeof metadata.authorization_endpoint !== "string" ||
    typeof metadata.token_endpoint !== "string" ||
    typeof metadata.jwks_uri !== "string"
  ) {
    throw new Error("The identity provider metadata is incomplete.");
  }
  return metadata as OidcMetadata;
}

function configuredPublicOrigin(request: Request): string | null {
  const configured = process.env.PERMINISTER_PUBLIC_ORIGIN?.trim();
  let origin: URL;
  try {
    origin = new URL(configured || request.url);
  } catch {
    return null;
  }
  if (
    (origin.protocol !== "https:" && origin.protocol !== "http:") ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
  ) {
    return null;
  }
  return origin.origin;
}

function singleQueryParam(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : null;
}

function parseLoginState(value: string | undefined): OidcLoginState | null {
  if (!value || value.length > 4_000) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return null;
    const state = decoded as Record<string, unknown>;
    if (
      typeof state.state !== "string" ||
      !STATE_TOKEN_PATTERN.test(state.state) ||
      typeof state.nonce !== "string" ||
      !STATE_TOKEN_PATTERN.test(state.nonce) ||
      typeof state.codeVerifier !== "string" ||
      !STATE_TOKEN_PATTERN.test(state.codeVerifier) ||
      typeof state.redirectUri !== "string" ||
      typeof state.providerKey !== "string" ||
      !/^oidc-[a-f0-9]{12}$/.test(state.providerKey) ||
      typeof state.invitationToken !== "string" ||
      state.invitationToken.length > 512 ||
      (state.next !== null && typeof state.next !== "string")
    ) {
      return null;
    }
    const redirectUri = new URL(state.redirectUri);
    if (
      redirectUri.pathname !== FEDERATED_OIDC_CALLBACK_PATH ||
      redirectUri.search ||
      redirectUri.hash ||
      redirectUri.username ||
      redirectUri.password ||
      (process.env.NODE_ENV === "production" && redirectUri.protocol !== "https:") ||
      !["https:", "http:"].includes(redirectUri.protocol)
    ) {
      return null;
    }
    return {
      state: state.state,
      nonce: state.nonce,
      codeVerifier: state.codeVerifier,
      redirectUri: redirectUri.toString(),
      providerKey: state.providerKey,
      next: typeof state.next === "string" ? safeConsumerAuthorizationReturnTo(state.next) : null,
      invitationToken: state.invitationToken,
    };
  } catch {
    return null;
  }
}

export async function handleFederatedOidcLoginStart(request: Request): Promise<Response> {
  const configuration = configuredProvider();
  const origin = configuredPublicOrigin(request);
  const params = new URL(request.url).searchParams;
  const nextInput = singleQueryParam(params, "next");
  const invitationInput = singleQueryParam(params, "invitationToken");
  const next = safeConsumerAuthorizationReturnTo(nextInput ?? "");
  const invitationToken = invitationInput?.trim() ?? "";

  if (
    !configuration ||
    !origin ||
    params.getAll("next").length > 1 ||
    params.getAll("invitationToken").length > 1 ||
    invitationToken.length > 512
  ) {
    return publicRedirectResponse(request, "/login?error=oidc_unavailable");
  }

  try {
    const metadata = await discoverProvider(configuration);
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const redirectUri = new URL(FEDERATED_OIDC_CALLBACK_PATH, origin).toString();
    const storedState: OidcLoginState = {
      state,
      nonce,
      codeVerifier,
      redirectUri,
      providerKey: configuration.providerKey,
      next,
      invitationToken,
    };
    const cookieValue = Buffer.from(JSON.stringify(storedState)).toString("base64url");
    if (cookieValue.length > 4_000) {
      return publicRedirectResponse(request, "/login?error=oidc_request");
    }
    const cookieStore = await cookies();
    cookieStore.set(oidcStateCookieName(), cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: OIDC_STATE_COOKIE_MAX_AGE_SECONDS,
    });
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const authorizationUrl = new URL(metadata.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
      client_id: configuration.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return new Response(null, {
      status: 303,
      headers: {
        ...NO_STORE_HEADERS,
        Location: authorizationUrl.toString(),
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return publicRedirectResponse(request, "/login?error=oidc_unavailable");
  }
}

function isTokenResponse(value: unknown): value is { id_token: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { id_token?: unknown }).id_token === "string"
  );
}

async function exchangeAuthorizationCode(
  code: string,
  state: OidcLoginState,
  configuration: ProviderConfiguration,
  metadata: OidcMetadata,
): Promise<OidcIdentityClaims> {
  const encodedClientId = new URLSearchParams({ value: configuration.clientId }).get("value");
  const encodedClientSecret = new URLSearchParams({ value: configuration.clientSecret }).get(
    "value",
  );
  const authorization = Buffer.from(`${encodedClientId}:${encodedClientSecret}`).toString("base64");
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code,
      redirect_uri: state.redirectUri,
      grant_type: "authorization_code",
      code_verifier: state.codeVerifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("The identity provider could not complete sign-in.");
  const tokenResponse: unknown = await response.json();
  if (!isTokenResponse(tokenResponse)) throw new Error("No identity token was returned.");

  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: 5_000 });
  const { payload } = await jwtVerify(tokenResponse.id_token, jwks, {
    algorithms: ["RS256", "ES256"],
    audience: configuration.clientId,
    issuer: configuration.issuer,
    clockTolerance: 5,
  });
  if (
    payload.nonce !== state.nonce ||
    (payload.azp !== undefined && payload.azp !== configuration.clientId) ||
    typeof payload.sub !== "string" ||
    !/^[\x21-\x7e]{1,255}$/.test(payload.sub) ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new Error("The identity provider did not return a verified email address.");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: true,
    ...(typeof payload.given_name === "string" ? { given_name: payload.given_name } : {}),
    ...(typeof payload.family_name === "string" ? { family_name: payload.family_name } : {}),
  };
}

export async function handleFederatedOidcLoginCallback(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  const loginState = parseLoginState(cookieStore.get(oidcStateCookieName())?.value);
  cookieStore.delete(oidcStateCookieName());
  const params = new URL(request.url).searchParams;
  const returnedState = singleQueryParam(params, "state");
  const configuration = configuredProvider();
  if (
    !loginState ||
    !configuration ||
    loginState.providerKey !== configuration.providerKey ||
    returnedState !== loginState.state
  ) {
    return publicRedirectResponse(request, "/login?error=oidc_request");
  }

  const providerError = singleQueryParam(params, "error");
  if (providerError) {
    return publicRedirectResponse(
      request,
      providerError === "access_denied" ? "/login?error=oidc_cancelled" : "/login?error=oidc_unavailable",
    );
  }
  const code = singleQueryParam(params, "code");
  if (!code || code.length > 2_048 || params.getAll("code").length !== 1) {
    return publicRedirectResponse(request, "/login?error=oidc_request");
  }

  try {
    const metadata = await discoverProvider(configuration);
    const identity = await exchangeAuthorizationCode(code, loginState, configuration, metadata);
    const subject = await signInWithExternalIdentity({
      provider: configuration.providerKey,
      providerSubject: identity.sub,
      email: identity.email,
      emailVerified: identity.email_verified,
      firstName: identity.given_name,
      lastName: identity.family_name,
    });
    const session = await createSession(subject.subjectId);
    await setSessionCookie(session.token);
    return publicRedirectResponse(
      request,
      postLoginDestination(loginState.next, loginState.invitationToken),
    );
  } catch (error) {
    if (error instanceof FederatedAccountLinkRequiredError) {
      return publicRedirectResponse(request, "/login?error=oidc_link_required");
    }
    if (error instanceof Error && error.message === "This Perminister account cannot sign in.") {
      return publicRedirectResponse(request, "/login?error=oidc_account");
    }
    return publicRedirectResponse(request, "/login?error=oidc_unavailable");
  }
}
