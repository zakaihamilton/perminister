import "server-only";

import { createHash } from "node:crypto";
import { safeConsumerAuthorizationReturnTo } from "./consumer-sso";
import type { SubjectId } from "./domain";
import { publicRedirectResponse } from "./http";
import { postLoginDestination } from "./login-redirect";
import { createSession, setSessionCookie } from "./service";

const STATE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type BaseExternalOidcLoginState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  next: string | null;
  invitationToken: string;
};

export type ExternalOidcIdentity = {
  sub: string;
  email: string;
  email_verified: true;
  given_name?: string;
  family_name?: string;
};

export function configuredPublicOrigin(request: Request): string | null {
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

export function readSingleQueryParam(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

export function createExternalOidcAuthorizationUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  prompt?: string;
}): string {
  const codeChallenge = createHash("sha256").update(input.codeVerifier).digest("base64url");
  const authorizationUrl = new URL(input.authorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...(input.prompt ? { prompt: input.prompt } : {}),
  }).toString();
  return authorizationUrl.toString();
}

export function parseExternalOidcLoginState(
  value: string | undefined,
  expectedCallbackPath: string,
): (BaseExternalOidcLoginState & { raw: Record<string, unknown> }) | null {
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
      redirectUri.pathname !== expectedCallbackPath ||
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
      raw: state,
    };
  } catch {
    return null;
  }
}

export function extractVerifiedOidcIdentity(
  payload: Record<string, unknown>,
  expectedNonce: string,
  expectedClientId: string,
  missingEmailMessage: string,
): ExternalOidcIdentity {
  if (
    payload.nonce !== expectedNonce ||
    (payload.azp !== undefined && payload.azp !== expectedClientId) ||
    typeof payload.sub !== "string" ||
    !/^[\x21-\x7e]{1,255}$/.test(payload.sub) ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new Error(missingEmailMessage);
  }
  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: true,
    ...(typeof payload.given_name === "string" ? { given_name: payload.given_name } : {}),
    ...(typeof payload.family_name === "string" ? { family_name: payload.family_name } : {}),
  };
}

export async function completeExternalOidcSignIn(input: {
  request: Request;
  loginState: BaseExternalOidcLoginState;
  signIn: () => Promise<{ subjectId: SubjectId }>;
}): Promise<Response> {
  const subject = await input.signIn();
  const session = await createSession(subject.subjectId);
  await setSessionCookie(session.token);
  return publicRedirectResponse(
    input.request,
    postLoginDestination(input.loginState.next, input.loginState.invitationToken),
  );
}
