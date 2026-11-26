import { timingSafeEqual } from "node:crypto";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { readMigrationRequest } from "@/lib/auth/migration-request";
import {
  importSystemConceptsLegacyIdentities,
  type SystemConceptsLegacyIdentity,
} from "@/lib/auth/service";

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

function validIdentity(value: unknown): value is SystemConceptsLegacyIdentity {
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

function validMigrationBatch(
  value: unknown,
): value is Record<string, unknown> & {
  apply: boolean;
  identities: SystemConceptsLegacyIdentity[];
} {
  return (
    isJsonObject(value) &&
    Object.keys(value).every((key) => ["apply", "identities"].includes(key)) &&
    typeof value.apply === "boolean" &&
    Array.isArray(value.identities) &&
    value.identities.length <= MAX_IDENTITIES &&
    value.identities.every(validIdentity)
  );
}

export async function POST(request: Request) {
  const parsed = await readMigrationRequest(
    request,
    MAX_BODY_BYTES,
    "systemconcepts",
    authorized(request),
    validMigrationBatch,
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  try {
    const summary = await importSystemConceptsLegacyIdentities(body.identities, body.apply);
    return Response.json(summary, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json({ error: "Identity migration is temporarily unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
