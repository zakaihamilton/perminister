import "server-only";

import {
  legacyConsumerAuthorizationEnabled,
  parseConsumerAuthorizationRequest,
  safeConsumerAuthorizationReturnTo,
} from "@/lib/auth/consumer-sso";
import { postLoginDestination } from "@/lib/auth/login-redirect";
import { passwordRecoveryRequesterKey } from "@/lib/auth/coordination";
import {
  isSameOriginBrowserRequest,
  publicRedirectResponse,
  readBoundedRequestBody,
} from "@/lib/auth/http";
import {
  authenticate,
  consumeLoginRequestRateLimit,
  createSession,
  getConsumerClientRecord,
  setSessionCookie,
} from "@/lib/auth/service";

const MAX_LOGIN_FORM_BYTES = 8 * 1024;
const MAX_LOGIN_PASSWORD_LENGTH = 256;
const CONSUMER_CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function boundedLoginFormData(request: Request): Promise<FormData> {
  const bytes = await readBoundedRequestBody(request, MAX_LOGIN_FORM_BYTES);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: bytes,
  }).formData();
}

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function loginPath(error: string, invitationToken: string, next: string | null): string {
  const query = new URLSearchParams({ error });
  if (invitationToken) query.set("invitationToken", invitationToken);
  if (next) query.set("next", next);
  return `/login?${query.toString()}`;
}

async function productIdForLogin(next: string | null): Promise<string | undefined> {
  if (!next) return undefined;
  const authorizationUrl = new URL(next, "https://perminister.invalid");
  const clientId = authorizationUrl.searchParams.get("client_id") ?? "";
  if (!CONSUMER_CLIENT_ID_PATTERN.test(clientId)) return undefined;
  const client = await getConsumerClientRecord(clientId);
  if (!client) return undefined;
  const authorization = parseConsumerAuthorizationRequest(authorizationUrl.searchParams, client, {
    allowLegacy: legacyConsumerAuthorizationEnabled(),
  });
  return authorization ? client.productId : undefined;
}

export async function handleLoginPost(request: Request): Promise<Response> {
  if (!isSameOriginBrowserRequest(request)) {
    return publicRedirectResponse(request, loginPath("request", "", null));
  }

  const callerKey = passwordRecoveryRequesterKey(request.headers);
  if (callerKey) {
    try {
      if (!(await consumeLoginRequestRateLimit(callerKey))) {
        return publicRedirectResponse(request, loginPath("throttled", "", null));
      }
    } catch {
      return publicRedirectResponse(request, loginPath("unavailable", "", null));
    }
  }

  let formData: FormData;
  try {
    formData = await boundedLoginFormData(request);
  } catch {
    return publicRedirectResponse(request, loginPath("request", "", null));
  }

  const identifier = formValue(formData, "identifier") || formValue(formData, "email");
  const password = formValue(formData, "password");
  const invitationToken = formValue(formData, "invitationToken");
  const next = safeConsumerAuthorizationReturnTo(formValue(formData, "next"));

  if (password.length > MAX_LOGIN_PASSWORD_LENGTH) {
    return publicRedirectResponse(request, loginPath("credentials", invitationToken, next));
  }

  try {
    const productId = await productIdForLogin(next);
    const subject = await authenticate(identifier, password, productId);
    const session = await createSession(subject.subjectId);
    await setSessionCookie(session.token);
  } catch (error) {
    const code =
      error instanceof Error && error.message === "Email or password is incorrect."
        ? "credentials"
        : "unavailable";
    return publicRedirectResponse(request, loginPath(code, invitationToken, next));
  }

  return publicRedirectResponse(request, postLoginDestination(next, invitationToken));
}
