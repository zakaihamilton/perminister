import "server-only";

import { safeConsumerAuthorizationReturnTo } from "@/lib/auth/consumer-sso";
import { passwordRecoveryRequesterKey } from "@/lib/auth/coordination";
import {
  isSameOriginBrowserRequest,
  publicRedirectResponse,
  readBoundedRequestBody,
} from "@/lib/auth/http";
import { processLocalLoginRequestThrottle } from "@/lib/auth/login-throttle";
import { authenticate, createSession, setSessionCookie } from "@/lib/auth/service";

const MAX_LOGIN_FORM_BYTES = 8 * 1024;
const MAX_LOGIN_PASSWORD_LENGTH = 256;

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

export async function handleLoginPost(request: Request): Promise<Response> {
  if (!isSameOriginBrowserRequest(request)) {
    return publicRedirectResponse(request, loginPath("request", "", null));
  }

  const callerKey = passwordRecoveryRequesterKey(request.headers);
  if (callerKey && !processLocalLoginRequestThrottle.consume(callerKey)) {
    return publicRedirectResponse(request, loginPath("throttled", "", null));
  }

  let formData: FormData;
  try {
    formData = await boundedLoginFormData(request);
  } catch {
    return publicRedirectResponse(request, loginPath("request", "", null));
  }

  const email = formValue(formData, "email");
  const password = formValue(formData, "password");
  const invitationToken = formValue(formData, "invitationToken");
  const next = safeConsumerAuthorizationReturnTo(formValue(formData, "next"));

  if (password.length > MAX_LOGIN_PASSWORD_LENGTH) {
    return publicRedirectResponse(request, loginPath("credentials", invitationToken, next));
  }

  try {
    const subject = await authenticate(email, password);
    const session = await createSession(subject.subjectId);
    await setSessionCookie(session.token);
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith("Too many sign-in attempts")
        ? "throttled"
        : error instanceof Error && error.message === "Email or password is incorrect."
          ? "credentials"
          : "unavailable";
    return publicRedirectResponse(request, loginPath(code, invitationToken, next));
  }

  return publicRedirectResponse(
    request,
    next ??
      (invitationToken
        ? `/accept-invitation?token=${encodeURIComponent(invitationToken)}`
        : "/dashboard"),
  );
}
