import type { ConsumerClientRecord } from "./domain";

export const CONSUMER_SSO_CALLBACK_PATH = "/auth/perminister/callback";

export type ConsumerAuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  responseType: "code";
  state: string;
  codeChallenge: string;
};

export function parseConsumerAuthorizationRequest(
  params: URLSearchParams,
  client?: ConsumerClientRecord | null,
): ConsumerAuthorizationRequest | null {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = params.get("response_type");
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const challengeMethod = params.get("code_challenge_method");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId) ||
    responseType !== "code" ||
    challengeMethod !== "S256" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(state) ||
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
  const origin = client?.appOrigin;
  if (
    !origin ||
    client?.status !== "active" ||
    callback.origin !== origin ||
    callback.pathname !== CONSUMER_SSO_CALLBACK_PATH ||
    callback.search ||
    callback.hash ||
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
    codeChallenge,
  };
}

export function consumerAuthorizationQuery(request: ConsumerAuthorizationRequest): string {
  return new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: request.responseType,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
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
