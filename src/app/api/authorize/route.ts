import { authorizeApiKey, type AuthorizationRequest } from "@/lib/auth/service";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Vary": "Authorization",
};

class RequestBodyTooLargeError extends Error {}

async function readJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body is empty.");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 8192) {
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

function isAuthorizationRequest(value: unknown): value is AuthorizationRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const resourcePart = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  return (
    typeof candidate.organizationId === "string" && identifier.test(candidate.organizationId) &&
    typeof candidate.productId === "string" && resourcePart.test(candidate.productId) &&
    (candidate.resourceKind === "product" || candidate.resourceKind === "project" || candidate.resourceKind === "workspace") &&
    (candidate.resourceId === undefined || (typeof candidate.resourceId === "string" && resourcePart.test(candidate.resourceId))) &&
    (candidate.resourceKind === "product" || (typeof candidate.resourceId === "string" && resourcePart.test(candidate.resourceId))) &&
    typeof candidate.action === "string" && /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(candidate.action)
  );
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers: noStoreHeaders });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8192) {
    return Response.json({ error: "Request body is too large." }, { status: 413, headers: noStoreHeaders });
  }
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) {
    return Response.json({ error: "A bearer API key is required." }, { status: 401, headers: noStoreHeaders });
  }
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Request body is too large." }, { status: 413, headers: noStoreHeaders });
    }
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStoreHeaders });
  }
  if (!isAuthorizationRequest(body)) {
    return Response.json({ error: "Provide organizationId, productId, resourceKind, optional resourceId, and action." }, { status: 400, headers: noStoreHeaders });
  }
  try {
    const result = await authorizeApiKey(match[1], body);
    return Response.json(
      result.authorized ? { authorized: true, subjectId: result.subjectId } : { authorized: false },
      { status: result.authorized ? 200 : 403, headers: noStoreHeaders },
    );
  } catch {
    return Response.json({ error: "Authorization service is temporarily unavailable." }, { status: 503, headers: noStoreHeaders });
  }
}
