import "server-only";

import { safeConsumerAuthorizationReturnTo } from "@/lib/auth/consumer-sso";
import { isSameOriginBrowserRequest, publicRedirectResponse } from "@/lib/auth/http";
import { authenticate, createSession, setSessionCookie } from "@/lib/auth/service";

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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return publicRedirectResponse(request, loginPath("request", "", null));
  }

  const email = formValue(formData, "email");
  const password = formValue(formData, "password");
  const invitationToken = formValue(formData, "invitationToken");
  const next = safeConsumerAuthorizationReturnTo(formValue(formData, "next"));

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
