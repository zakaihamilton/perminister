import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import {
  GOOGLE_LOGIN_CALLBACK_PATH,
  safeConsumerAuthorizationReturnTo,
} from "./consumer-sso";
import {
  completeExternalOidcSignIn,
  configuredPublicOrigin,
  extractVerifiedOidcIdentity,
  parseExternalOidcLoginState,
  readSingleQueryParam,
} from "./external-oidc-helpers";
import { NO_STORE_HEADERS, publicRedirectResponse } from "./http";
import {
  GoogleAccountLinkRequiredError,
  signInWithGoogle,
} from "./service";

export const GOOGLE_CALLBACK_PATH = GOOGLE_LOGIN_CALLBACK_PATH;
const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

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

function parseGoogleLoginState(value: string | undefined): GoogleLoginState | null {
  const parsed = parseExternalOidcLoginState(value, GOOGLE_CALLBACK_PATH);
  if (!parsed) return null;
  return {
    state: parsed.state,
    nonce: parsed.nonce,
    codeVerifier: parsed.codeVerifier,
    redirectUri: parsed.redirectUri,
    next: parsed.next,
    invitationToken: parsed.invitationToken,
  };
}

function isTokenResponse(value: unknown): value is GoogleTokenResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return extractVerifiedOidcIdentity(
    payload as Record<string, unknown>,
    state.nonce,
    clientId,
    "Google did not return a verified email address.",
  );
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
    return await completeExternalOidcSignIn({
      request,
      loginState,
      signIn: () =>
        signInWithGoogle({
          providerSubject: identity.sub,
          email: identity.email,
          emailVerified: identity.email_verified,
          firstName: identity.given_name,
          lastName: identity.family_name,
        }),
    });
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
