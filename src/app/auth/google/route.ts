import { NextResponse } from "next/server";

const AUTH_COOKIE_NAMES = [
  "perminister_session",
  "__Host-perminister_google_oauth",
  "__Host-perminister_oidc_oauth",
  "perminister_google_oauth",
  "perminister_oidc_oauth",
] as const;

function expireCookie(
  response: NextResponse,
  name: string,
  domain?: string,
): void {
  response.cookies.set(name, "", {
    ...(domain ? { domain } : {}),
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || name.startsWith("__Host-"),
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recover old or malformed Google sign-in links without making the user clear
 * browser data manually. Stop at the login page so the next attempt starts a
 * fresh OAuth flow rather than repeating the redirect that brought them here.
 */
export async function GET(request: Request): Promise<Response> {
  const response = NextResponse.redirect(
    new URL("/login?error=google_request", request.url),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");

  const hostname = new URL(request.url).hostname;
  const canClearPerministerDomainCookies =
    hostname === "perminister.com" || hostname.endsWith(".perminister.com");

  for (const name of AUTH_COOKIE_NAMES) {
    expireCookie(response, name);

    // Clear cookies from older releases that may have used Domain=perminister.com.
    // __Host- cookies must remain host-only by definition.
    if (canClearPerministerDomainCookies && !name.startsWith("__Host-")) {
      expireCookie(response, name, "perminister.com");
    }
  }

  return response;
}
