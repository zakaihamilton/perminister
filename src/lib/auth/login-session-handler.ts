import "server-only";

import { safeConsumerAuthorizationReturnTo } from "@/lib/auth/consumer-sso";
import { authenticate, createSession, setSessionCookie } from "@/lib/auth/service";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const PUBLIC_ORIGIN_HOST_HEADER = "x-perminister-public-host";
const PUBLIC_ORIGIN_PROTOCOL_HEADER = "x-perminister-public-proto";

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isSameOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  if (!originHeader && !refererHeader) return false;

  try {
    // Browsers normally send Origin on POSTs. Use Referer as a same-origin
    // fallback for clients that omit it, while still rejecting cross-origin
    // submissions before reading the form body.
    const source = new URL(originHeader ?? refererHeader!);
    const requestUrl = new URL(request.url);
    const publicProtocol = request.headers.get(PUBLIC_ORIGIN_PROTOCOL_HEADER);
    const host =
      request.headers.get(PUBLIC_ORIGIN_HOST_HEADER) ?? request.headers.get("host");
    const protocol = publicProtocol ?? requestUrl.protocol.slice(0, -1);
    const isSameOriginFetch = request.headers.get("sec-fetch-site") === "same-origin";

    return (
      !!host &&
      source.host === host &&
      (source.protocol === `${protocol}:` || (!publicProtocol && isSameOriginFetch)) &&
      (!originHeader || (source.pathname === "/" && !source.search && !source.hash)) &&
      !source.username &&
      !source.password
    );
  } catch {
    return false;
  }
}

function redirectResponse(request: Request, path: string): Response {
  // The writer may receive an internal Railway request URL. Origin or Referer
  // has already passed isSameOriginRequest, so it provides the browser origin.
  const redirectBase =
    request.headers.get("origin") ?? request.headers.get("referer") ?? request.url;

  return new Response(null, {
    status: 303,
    headers: {
      ...NO_STORE_HEADERS,
      Location: new URL(path, redirectBase).toString(),
    },
  });
}

function loginPath(error: string, invitationToken: string, next: string | null): string {
  const query = new URLSearchParams({ error });
  if (invitationToken) query.set("invitationToken", invitationToken);
  if (next) query.set("next", next);
  return `/login?${query.toString()}`;
}

function invalidRequestResponse(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      ...NO_STORE_HEADERS,
      Location: loginPath("request", "", null),
    },
  });
}

export async function handleLoginPost(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    // A relative location returns the browser to this app without trusting a
    // possibly cross-origin Origin or Referer header.
    return invalidRequestResponse();
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectResponse(request, loginPath("request", "", null));
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
    return redirectResponse(request, loginPath(code, invitationToken, next));
  }

  return redirectResponse(
    request,
    next ??
      (invitationToken
        ? `/accept-invitation?token=${encodeURIComponent(invitationToken)}`
        : "/dashboard"),
  );
}
