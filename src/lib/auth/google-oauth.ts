import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NO_STORE_HEADERS, publicRedirectResponse } from "./http";
import {
  GOOGLE_LOGIN_CALLBACK_PATH,
  safeConsumerAuthorizationReturnTo,
} from "./consumer-sso";
import { postLoginDestination } from "./login-redirect";
import {
  createSession,
  GoogleAccountLinkRequiredError,
  setSessionCookie,
  signInWithGoogle,
} from "./service";

export const GOOGLE_CALLBACK_PATH = GOOGLE_LOGIN_CALLBACK_PATH;
const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const STATE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type GoogleLoginState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  next: string | null;
  invitationToken: string;
};

type GoogleTokenResponse = {
  id_token?: unknown;
};

type GoogleIdentityClaims = {
  sub: string;
  email: string;
  email_verified: true;
  given_name?: string;
  family_name?: string;
};

function googleStateCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-perminister_google_oauth"
    : "perminister_google_oauth";
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

function readSingleQueryParam(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? values[0]! : null;
}

function parseGoogleLoginState(value: string | undefined): GoogleLoginState | null {
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
      typeof state.invitationToken !== "string" ||
      state.invitationToken.length > 512 ||
      (state.next !== null && typeof state.next !== "string")
    ) {
      return null;
    }

    const redirectUri = new URL(state.redirectUri);
    if (
      redirectUri.pathname !== GOOGLE_CALLBACK_PATH ||
      redirectUri.search ||
      redirectUri.hash ||
      redirectUri.username ||
      redirectUri.password ||
      (process.env.NODE_ENV === "production" && redirectUri.protocol !== "https:") ||
      (redirectUri.protocol !== "https:" && redirectUri.protocol !== "http:")
    ) {
      return null;
    }

    return {
      state: state.state,
      nonce: state.nonce,
      codeVerifier: state.codeVerifier,
      redirectUri: redirectUri.toString(),
      next:
        typeof state.next === "string" ? safeConsumerAuthorizationReturnTo(state.next) : null,
      invitationToken: state.invitationToken,
    };
  } catch {
    return null;
  }
}

function isTokenResponse(value: unknown): value is GoogleTokenResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function googleLoginConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID?.trim();
}

export async function handleGoogleLoginStart(request: Request): Promise<Response> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const origin = configuredPublicOrigin(request);
  const params = new URL(request.url).searchParams;
  const nextInput = readSingleQueryParam(params, "next");
  const invitationInput = readSingleQueryParam(params, "invitationToken");
  const next = safeConsumerAuthorizationReturnTo(nextInput ?? "");
  const invitationToken = invitationInput?.trim() ?? "";

  if (
    !clientId ||
    !origin ||
    params.getAll("next").length > 1 ||
    params.getAll("invitationToken").length > 1 ||
    invitationToken.length > 512
  ) {
    return publicRedirectResponse(request, "/login?error=google_unavailable");
  }

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const redirectUri = new URL(GOOGLE_CALLBACK_PATH, origin).toString();
  const storedState: GoogleLoginState = {
    state,
    nonce,
    codeVerifier,
    redirectUri,
    next,
    invitationToken,
  };
  const cookieValue = Buffer.from(JSON.stringify(storedState)).toString("base64url");
  if (cookieValue.length > 4_000) {
    return publicRedirectResponse(request, "/login?error=google_request");
  }

  const cookieStore = await cookies();
  cookieStore.set(googleStateCookieName(), cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GOOGLE_STATE_COOKIE_MAX_AGE_SECONDS,
  });

  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  return new Response(null, {
    status: 303,
    headers: {
      ...NO_STORE_HEADERS,
      Location: authorizationUrl.toString(),
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function exchangeGoogleCode(
  code: string,
  state: GoogleLoginState,
): Promise<GoogleIdentityClaims> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Google login is not configured.");

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: state.redirectUri,
      grant_type: "authorization_code",
      code_verifier: state.codeVerifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Google could not complete sign-in.");

  const tokenResponse: unknown = await response.json();
  if (!isTokenResponse(tokenResponse) || typeof tokenResponse.id_token !== "string") {
    throw new Error("Google did not return an identity token.");
  }

  const { payload } = await jwtVerify(tokenResponse.id_token, GOOGLE_JWKS, {
    algorithms: ["RS256"],
    audience: clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    clockTolerance: 5,
  });
  if (
    payload.nonce !== state.nonce ||
    (payload.azp !== undefined && payload.azp !== clientId) ||
    typeof payload.sub !== "string" ||
    !/^[\x21-\x7e]{1,255}$/.test(payload.sub) ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new Error("Google did not return a verified email address.");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: true,
    ...(typeof payload.given_name === "string" ? { given_name: payload.given_name } : {}),
    ...(typeof payload.family_name === "string" ? { family_name: payload.family_name } : {}),
  };
}

export async function handleGoogleLoginCallback(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  const loginState = parseGoogleLoginState(
    cookieStore.get(googleStateCookieName())?.value,
  );
  cookieStore.delete(googleStateCookieName());

  const params = new URL(request.url).searchParams;
  const returnedState = readSingleQueryParam(params, "state");
  if (!loginState || returnedState !== loginState.state) {
    return publicRedirectResponse(request, "/login?error=google_request");
  }

  const providerError = readSingleQueryParam(params, "error");
  if (providerError) {
    return publicRedirectResponse(
      request,
      providerError === "access_denied"
        ? "/login?error=google_cancelled"
        : "/login?error=google_unavailable",
    );
  }

  const code = readSingleQueryParam(params, "code");
  if (!code || code.length > 2_048 || params.getAll("code").length !== 1) {
    return publicRedirectResponse(request, "/login?error=google_request");
  }

  try {
    const identity = await exchangeGoogleCode(code, loginState);
    const subject = await signInWithGoogle({
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
    if (error instanceof GoogleAccountLinkRequiredError) {
      return publicRedirectResponse(request, "/login?error=google_link_required");
    }
    if (error instanceof Error && error.message === "This Perminister account cannot sign in.") {
      return publicRedirectResponse(request, "/login?error=google_account");
    }
    return publicRedirectResponse(request, "/login?error=google_unavailable");
  }
}
