import { safeConsumerAuthorizationReturnTo } from "@/lib/auth/consumer-sso";
import {
  authenticate,
  createSession,
  getCurrentSession,
  setSessionCookie,
} from "@/lib/auth/service";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isSameOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;

  try {
    const origin = new URL(originHeader);
    const requestUrl = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const protocol = request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.slice(0, -1);

    return (
      !!host &&
      origin.host === host &&
      origin.protocol === `${protocol}:` &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash &&
      !origin.username &&
      !origin.password
    );
  } catch {
    return false;
  }
}

function redirectResponse(request: Request, path: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      ...NO_STORE_HEADERS,
      Location: new URL(path, request.url).toString(),
    },
  });
}

function loginPath(error: string, invitationToken: string, next: string | null): string {
  const query = new URLSearchParams({ error });
  if (invitationToken) query.set("invitationToken", invitationToken);
  if (next) query.set("next", next);
  return `/login?${query.toString()}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Forbidden." }, { status: 403, headers: NO_STORE_HEADERS });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "Invalid sign-in request." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
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

export async function GET() {
  try {
    const current = await getCurrentSession();
    if (!current) {
      return Response.json(
        { authenticated: false },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      {
        authenticated: true,
        account: {
          subjectId: current.subject.subjectId,
          email: current.subject.primaryEmail,
          firstName: current.subject.firstName ?? null,
          lastName: current.subject.lastName ?? null,
          emailVerified: !!current.subject.emailVerifiedAt,
          status: current.subject.status,
        },
        session: {
          createdAt: current.session.createdAt,
          expiresAt: current.session.expiresAt,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Session service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
