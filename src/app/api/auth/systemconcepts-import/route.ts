import { timingSafeEqual } from "node:crypto";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { importSystemConceptsLegacyIdentities } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IDENTITIES = 10_000;

function authorized(request: Request): boolean {
  if (process.env.PERMINISTER_ENABLE_SYSTEMCONCEPTS_IMPORT !== "true") return false;
  const expected = process.env.PERMINISTER_SYSTEMCONCEPTS_IMPORT_SECRET ?? "";
  const provided = request.headers.get("x-perminister-migration-secret") ?? "";
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (expectedBytes.length < 32 || providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

function validIdentity(value: unknown): value is {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  passwordHash: string;
} {
  if (!isJsonObject(value)) return false;
  const allowedKeys = new Set(["id", "email", "firstName", "lastName", "passwordHash"]);
  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    typeof value.id === "string" &&
    (value.email === undefined || value.email === null || typeof value.email === "string") &&
    (value.firstName === undefined || value.firstName === null || typeof value.firstName === "string") &&
    (value.lastName === undefined || value.lastName === null || typeof value.lastName === "string") &&
    typeof value.passwordHash === "string"
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE_HEADERS });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Expected a JSON migration batch." }, { status: 415, headers: NO_STORE_HEADERS });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Migration batch is too large." }, { status: 413, headers: NO_STORE_HEADERS });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ error: "Invalid migration batch." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "Migration batch is too large." }, { status: 413, headers: NO_STORE_HEADERS });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid migration batch." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (
    !isJsonObject(body) ||
    Object.keys(body).some((key) => !["apply", "identities"].includes(key)) ||
    typeof body.apply !== "boolean" ||
    !Array.isArray(body.identities) ||
    body.identities.length > MAX_IDENTITIES ||
    !body.identities.every(validIdentity)
  ) {
    return Response.json({ error: "Invalid migration batch." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const summary = await importSystemConceptsLegacyIdentities(body.identities, body.apply);
    return Response.json(summary, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json({ error: "Identity migration is temporarily unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
