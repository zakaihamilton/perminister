import { createDecipheriv, timingSafeEqual } from "node:crypto";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { importSentry8LegacyMemberships, type Sentry8LegacyMembership } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_MEMBERSHIPS = 10_000;

function authorized(request: Request): boolean {
  if (process.env.PERMINISTER_ENABLE_SENTRY8_IMPORT !== "true") return false;
  const expected = process.env.PERMINISTER_SENTRY8_IMPORT_SECRET ?? "";
  const provided = request.headers.get("x-perminister-migration-secret") ?? "";
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length >= 32 &&
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validMembership(value: unknown): value is Sentry8LegacyMembership {
  if (!isJsonObject(value)) return false;
  const allowedKeys = new Set([
    "sentry8UserId",
    "projectId",
    "projectSlug",
    "projectName",
    "organizationId",
    "productId",
    "resourceId",
    "resourceUri",
    "email",
    "displayName",
    "passwordHash",
    "perministerSubjectId",
    "role",
    "status",
    "perministerRole",
  ]);
  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    typeof value.sentry8UserId === "string" &&
    typeof value.projectId === "string" &&
    typeof value.projectSlug === "string" &&
    typeof value.projectName === "string" &&
    isNullableString(value.organizationId) &&
    isNullableString(value.productId) &&
    isNullableString(value.resourceId) &&
    isNullableString(value.resourceUri) &&
    typeof value.email === "string" &&
    typeof value.displayName === "string" &&
    isNullableString(value.passwordHash) &&
    isNullableString(value.perministerSubjectId) &&
    ["viewer", "manager", "administrator"].includes(String(value.role)) &&
    ["active", "locked"].includes(String(value.status)) &&
    ["viewer", "editor", "admin"].includes(String(value.perministerRole))
  );
}

function decryptEnvelope(body: Record<string, unknown>): unknown {
  const encodedKey = process.env.PERMINISTER_SENTRY8_IMPORT_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encodedKey, "base64url");
  if (
    body.format !== "sentry8-perminister-encrypted/v1" ||
    body.algorithm !== "aes-256-gcm" ||
    typeof body.iv !== "string" ||
    typeof body.tag !== "string" ||
    typeof body.ciphertext !== "string" ||
    key.length !== 32
  ) {
    throw new Error("Invalid encrypted migration envelope.");
  }
  const iv = Buffer.from(body.iv, "base64url");
  const tag = Buffer.from(body.tag, "base64url");
  const ciphertext = Buffer.from(body.ciphertext, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new Error("Invalid encrypted migration envelope.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as unknown;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE_HEADERS });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Expected an encrypted JSON manifest." }, { status: 415, headers: NO_STORE_HEADERS });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Migration manifest is too large." }, { status: 413, headers: NO_STORE_HEADERS });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ error: "Invalid migration manifest." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "Migration manifest is too large." }, { status: 413, headers: NO_STORE_HEADERS });
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid migration manifest." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (
    !isJsonObject(envelope) ||
    Object.keys(envelope).some(
      (key) => !["format", "algorithm", "iv", "tag", "ciphertext", "apply"].includes(key),
    ) ||
    typeof envelope.apply !== "boolean"
  ) {
    return Response.json({ error: "Invalid migration manifest." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  let manifest: unknown;
  try {
    manifest = decryptEnvelope(envelope);
  } catch {
    return Response.json({ error: "Invalid migration manifest." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (
    !isJsonObject(manifest) ||
    manifest.format !== "sentry8-perminister-user-migration/v1" ||
    !Array.isArray(manifest.memberships) ||
    manifest.memberships.length > MAX_MEMBERSHIPS ||
    !manifest.memberships.every(validMembership)
  ) {
    return Response.json({ error: "Invalid migration manifest." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const summary = await importSentry8LegacyMemberships(
      manifest.memberships,
      envelope.apply,
    );
    return Response.json(summary, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { error: "Sentry8 identity migration is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
