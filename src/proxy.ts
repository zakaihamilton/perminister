import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { lastValidForwardedIp } from "@/lib/client-ip";
import { currentDeploymentId } from "@/lib/deployment";
import { parseConsumerAuthorizationRequest } from "@/lib/auth/consumer-sso";
import { getConsumerClientRecord } from "@/lib/auth/service";
import {
  getConfiguredWriteProxySecret,
  matchesWriteProxySecret,
  WRITE_PROXY_SECRET_HEADER,
} from "@/lib/write-proxy-secret";

const PUBLIC_ORIGIN_HOST_HEADER = "x-perminister-public-host";
const PUBLIC_ORIGIN_PROTOCOL_HEADER = "x-perminister-public-proto";
const PROXY_CLIENT_IP_HEADER = "x-perminister-client-ip";
const RELEASE_ID_HEADER = "x-perminister-release-id";
const RELEASE_MISMATCH_HEADER = "x-perminister-release-mismatch";
const ACTION_NOT_FOUND_HEADER = "x-nextjs-action-not-found";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const CLIENT_IP_HEADERS = [
  "x-vercel-forwarded-for",
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
];
const HEALTH_PATHS = new Set(["/api/health", "/api/ready"]);
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const CONTENT_SECURITY_POLICY_HEADER = "Content-Security-Policy";
const BASE_CONTENT_SECURITY_POLICY = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function errorResponse(status: number, error: string, extraHeaders?: HeadersInit): Response {
  return Response.json({ error }, { status, headers: { ...NO_STORE_HEADERS, ...extraHeaders } });
}

function isWriterRuntime(): boolean {
  return (
    process.env.PERMINISTER_WRITER_MODE === "true" ||
    (process.env.NODE_ENV === "production" && process.env.VERCEL !== "1")
  );
}

function refreshTarget(request: NextRequest): URL {
  let target = new URL(request.url);
  const referer = request.headers.get("referer");

  if (referer) {
    try {
      const referringPage = new URL(referer);
      if (
        referringPage.origin === request.nextUrl.origin &&
        !referringPage.pathname.startsWith("/actions/")
      ) {
        target = referringPage;
      }
    } catch {
      // Fall back to the request URL when the browser omits a valid page URL.
    }
  }

  if (target.pathname.startsWith("/actions/")) {
    target = new URL("/dashboard", request.url);
  }
  target.searchParams.set("__perminister_action", "refresh");
  return target;
}

function staleActionResponse(request: NextRequest): Response {
  const target = refreshTarget(request);
  const location = `${target.pathname}${target.search}`;
  if (request.headers.has("next-action")) {
    return new Response(null, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
        "x-action-redirect": `${location};replace`,
      },
    });
  }

  return new Response(null, {
    status: 303,
    headers: { ...NO_STORE_HEADERS, Location: target.toString() },
  });
}

function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

async function consumerAuthorizationPolicy(request: NextRequest): Promise<string | null> {
  if (request.nextUrl.pathname !== "/oauth/authorize" || request.method !== "GET") {
    return null;
  }

  const params = request.nextUrl.searchParams;
  const clientId = params.get("client_id") ?? "";
  const client = await getConsumerClientRecord(clientId).catch(() => null);
  const authorization = parseConsumerAuthorizationRequest(params, client);
  if (!authorization) return null;

  const callback = new URL(authorization.redirectUri);
  return `${BASE_CONTENT_SECURITY_POLICY} ${callback.origin}${callback.pathname}`;
}

function removeHopByHopHeaders(headers: Headers): void {
  const connectionTokens = headers.get("connection");

  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  for (const token of connectionTokens?.split(",") ?? []) {
    const name = token.trim();
    if (name) headers.delete(name);
  }
}

function extractTrustedClientIp(headers: Headers): string | null {
  for (const name of ["x-vercel-forwarded-for", "cf-connecting-ip", "x-real-ip"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    const candidate = raw.split(",")[0]?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  return lastValidForwardedIp(headers.get("x-forwarded-for"));
}

function forwardHeaders(request: NextRequest, secret: string): Headers {
  const headers = new Headers(request.headers);
  const clientIp = extractTrustedClientIp(request.headers);
  removeHopByHopHeaders(headers);
  for (const ipHeader of CLIENT_IP_HEADERS) headers.delete(ipHeader);
  headers.delete(PROXY_CLIENT_IP_HEADER);
  if (clientIp) headers.set(PROXY_CLIENT_IP_HEADER, clientIp);
  headers.delete("content-length");
  headers.delete("host");
  headers.set(WRITE_PROXY_SECRET_HEADER, secret);
  headers.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(/:$/, ""));
  // Preserve the browser-facing origin across the writer hop, where the host is rewritten.
  headers.set(PUBLIC_ORIGIN_HOST_HEADER, request.headers.get("host") ?? request.nextUrl.host);
  headers.set(PUBLIC_ORIGIN_PROTOCOL_HEADER, request.nextUrl.protocol.replace(/:$/, ""));
  const releaseId = currentDeploymentId();
  if (releaseId) headers.set(RELEASE_ID_HEADER, releaseId);
  return headers;
}

function responseHeaders(upstream: Response, writerOrigin: string): Headers {
  const headers = new Headers(upstream.headers);
  removeHopByHopHeaders(headers);
  // Fetch may decompress the upstream body, so the origin's length and encoding no longer apply.
  headers.delete("content-encoding");
  headers.delete("content-length");

  const location = headers.get("location");
  if (location) {
    try {
      const redirect = new URL(location, writerOrigin);
      if (redirect.origin === writerOrigin) {
        headers.set("location", `${redirect.pathname}${redirect.search}${redirect.hash}`);
      }
    } catch {
      // Preserve a non-URL Location value; the browser will handle it as the origin intended.
    }
  }

  return headers;
}

function getWriterOrigin(allowLocalHttp: boolean): string | null {
  const configuredUrl = process.env.PERMINISTER_WRITE_PROXY_URL;
  if (!configuredUrl) return null;

  try {
    const writerUrl = new URL(configuredUrl);
    const localHost = new Set(["localhost", "127.0.0.1", "[::1]"]).has(writerUrl.hostname);
    const secureProtocol = writerUrl.protocol === "https:";
    const localDevelopmentProtocol = allowLocalHttp && localHost && writerUrl.protocol === "http:";
    if (
      (!secureProtocol && !localDevelopmentProtocol) ||
      writerUrl.username ||
      writerUrl.password ||
      writerUrl.pathname !== "/" ||
      writerUrl.search ||
      writerUrl.hash
    ) {
      return null;
    }
    return writerUrl.origin;
  } catch {
    return null;
  }
}

function writerRequest(request: NextRequest): Response {
  if (isReadMethod(request.method)) {
    if (!HEALTH_PATHS.has(request.nextUrl.pathname)) {
      return errorResponse(404, "Not found.");
    }

    if (request.nextUrl.pathname === "/api/ready" && !getConfiguredWriteProxySecret()) {
      return errorResponse(503, "The writer service is not configured.");
    }

    return NextResponse.next();
  }

  if (!WRITE_METHODS.has(request.method)) {
    return errorResponse(405, "Method not allowed.");
  }

  const secret = getConfiguredWriteProxySecret();
  if (!secret) return errorResponse(503, "The writer service is not configured.");
  if (!matchesWriteProxySecret(request.headers.get(WRITE_PROXY_SECRET_HEADER), secret)) {
    return errorResponse(403, "Forbidden.");
  }

  if (process.env.NODE_ENV === "production") {
    const expectedReleaseId = request.headers.get(RELEASE_ID_HEADER);
    const currentReleaseId = currentDeploymentId();
    if (!expectedReleaseId || !currentReleaseId || expectedReleaseId !== currentReleaseId) {
      return errorResponse(503, "The writer is on a different deployment.", {
        [RELEASE_MISMATCH_HEADER]: "1",
      });
    }
  }

  const headers = new Headers(request.headers);
  headers.delete(WRITE_PROXY_SECRET_HEADER);
  return NextResponse.next({ request: { headers } });
}

async function proxyWrite(request: NextRequest): Promise<Response> {
  if (!WRITE_METHODS.has(request.method)) {
    return errorResponse(405, "Method not allowed.");
  }

  const hostedVercel = process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
  if (hostedVercel && process.env.VERCEL_ENV !== "production") {
    return errorResponse(503, "Mutations are only enabled in the production deployment.");
  }

  const secret = getConfiguredWriteProxySecret();
  const writerOrigin = getWriterOrigin(!hostedVercel && process.env.NODE_ENV !== "production");
  if (!secret || !writerOrigin) {
    return errorResponse(503, "The mutation proxy is not configured.");
  }

  const destination = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, writerOrigin);
  const body = await request.arrayBuffer();

  try {
    const upstream = await fetch(destination, {
      method: request.method,
      headers: forwardHeaders(request, secret),
      body,
      cache: "no-store",
      redirect: "manual",
    });

    if (upstream.headers.get(ACTION_NOT_FOUND_HEADER) === "1") {
      console.warn("Server action deployment skew detected", {
        path: request.nextUrl.pathname,
        clientReleaseId: request.headers.get("x-deployment-id"),
        currentReleaseId: currentDeploymentId(),
      });
      return staleActionResponse(request);
    }

    if (upstream.headers.get(RELEASE_MISMATCH_HEADER) === "1") {
      console.warn("Mutation blocked while deployments are out of sync", {
        path: request.nextUrl.pathname,
        currentReleaseId: currentDeploymentId(),
      });
      if (request.headers.get("accept")?.includes("application/json")) {
        return errorResponse(503, "Perminister is updating. Reload the page and try again.");
      }
      return staleActionResponse(request);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream, writerOrigin),
    });
  } catch {
    return errorResponse(502, "The writer service could not be reached.");
  }
}

export async function proxy(request: NextRequest): Promise<Response> {
  if (request.nextUrl.pathname === "/oauth/authorize" && request.method === "GET") {
    const response = NextResponse.next();
    const contentSecurityPolicy = await consumerAuthorizationPolicy(request);
    if (contentSecurityPolicy) {
      response.headers.set(CONTENT_SECURITY_POLICY_HEADER, contentSecurityPolicy);
    }
    return response;
  }

  const hostedVercel = process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
  if (hostedVercel) {
    if (isReadMethod(request.method)) return NextResponse.next();
    const clientReleaseId = request.headers.get("x-deployment-id");
    const currentReleaseId = currentDeploymentId();
    if (
      request.method === "POST" &&
      clientReleaseId &&
      currentReleaseId &&
      clientReleaseId !== currentReleaseId
    ) {
      console.warn("Stale page submission refreshed", {
        path: request.nextUrl.pathname,
        clientReleaseId,
        currentReleaseId,
      });
      return staleActionResponse(request);
    }
    return proxyWrite(request);
  }

  if (isWriterRuntime()) return writerRequest(request);

  if (!isReadMethod(request.method)) {
    const hasLocalProxyConfiguration =
      process.env.PERMINISTER_WRITE_PROXY_URL || process.env.PERMINISTER_WRITE_PROXY_SECRET;
    if (hasLocalProxyConfiguration) return proxyWrite(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/actions/:path*",
    "/oauth/authorize",
    "/accept-invitation",
    "/dashboard/:path*",
    "/forgot-password",
    "/login",
    "/login/submit",
    "/logout/submit",
    "/register",
    "/reset-password",
    "/verify-email",
  ],
};
