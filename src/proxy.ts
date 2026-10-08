import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const WRITE_PROXY_SECRET_HEADER = "x-perminister-write-proxy-secret";
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
const HEALTH_PATHS = new Set(["/api/health", "/api/ready"]);
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE_HEADERS });
}

function getConfiguredSecret(): string | null {
  const secret = process.env.PERMINISTER_WRITE_PROXY_SECRET;
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
}

function matchesSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
}

function isWriterRuntime(): boolean {
  return (
    process.env.PERMINISTER_WRITER_MODE === "true" ||
    (process.env.NODE_ENV === "production" && process.env.VERCEL !== "1")
  );
}

function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function forwardHeaders(request: NextRequest, secret: string): Headers {
  const headers = new Headers(request.headers);
  const connectionTokens = headers.get("connection");

  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  for (const token of connectionTokens?.split(",") ?? []) {
    const name = token.trim();
    if (name) headers.delete(name);
  }

  headers.delete("content-length");
  headers.delete("host");
  headers.set(WRITE_PROXY_SECRET_HEADER, secret);
  headers.set("x-forwarded-host", request.nextUrl.host);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(/:$/, ""));
  return headers;
}

function responseHeaders(upstream: Response, writerOrigin: string): Headers {
  const headers = new Headers(upstream.headers);
  const connectionTokens = headers.get("connection");

  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  for (const token of connectionTokens?.split(",") ?? []) {
    const name = token.trim();
    if (name) headers.delete(name);
  }

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

    if (request.nextUrl.pathname === "/api/ready" && !getConfiguredSecret()) {
      return errorResponse(503, "The writer service is not configured.");
    }

    return NextResponse.next();
  }

  if (!WRITE_METHODS.has(request.method)) {
    return errorResponse(405, "Method not allowed.");
  }

  const secret = getConfiguredSecret();
  if (!secret) return errorResponse(503, "The writer service is not configured.");
  if (!matchesSecret(request.headers.get(WRITE_PROXY_SECRET_HEADER), secret)) {
    return errorResponse(403, "Forbidden.");
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

  const secret = getConfiguredSecret();
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
  const hostedVercel = process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
  if (hostedVercel) {
    if (isReadMethod(request.method)) return NextResponse.next();
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
