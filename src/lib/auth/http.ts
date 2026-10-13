export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

const PUBLIC_ORIGIN_HOST_HEADER = "x-perminister-public-host";
const PUBLIC_ORIGIN_PROTOCOL_HEADER = "x-perminister-public-proto";

export function isSameOriginBrowserRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const isSameOriginFetch = request.headers.get("sec-fetch-site") === "same-origin";

  // Fetch Metadata is set by the browser and cannot be supplied by page
  // JavaScript. Use it when browser privacy settings or a local proxy omit or
  // rewrite Origin and Referer.
  if (isSameOriginFetch) return true;
  if (!originHeader && !refererHeader) return false;

  try {
    const source = new URL(originHeader ?? refererHeader!);
    const requestUrl = new URL(request.url);
    const publicProtocol = request.headers.get(PUBLIC_ORIGIN_PROTOCOL_HEADER);
    const host = request.headers.get(PUBLIC_ORIGIN_HOST_HEADER) ?? request.headers.get("host");
    const protocol = publicProtocol ?? requestUrl.protocol.slice(0, -1);
    return (
      !!host &&
      source.host === host &&
      source.protocol === `${protocol}:` &&
      (!originHeader || (source.pathname === "/" && !source.search && !source.hash)) &&
      !source.username &&
      !source.password
    );
  } catch {
    return false;
  }
}

export class RequestBodyTooLargeError extends Error {}

export async function readBoundedJson(request: Request, maximumBytes = 8192): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maximumBytes) throw new RequestBodyTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body is empty.");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

export function isJsonRequest(request: Request): boolean {
  return (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json"
  );
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
