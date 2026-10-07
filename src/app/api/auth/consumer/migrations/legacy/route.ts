import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import {
  hasActiveConsumerClientForProduct,
  importLegacyAuthData,
  type LegacyAuthImportInput,
} from "@/lib/auth/service";

export const runtime = "nodejs";

const sourceAccountId = z.string().trim().min(1).max(254);
const userEmail = z.email().max(254);
const encodedHash = z.string().min(1).max(4096);
const visitoringSchema = z
  .object({
    organizationId: z.string().uuid(),
    users: z
      .array(
        z.object({ id: sourceAccountId, email: userEmail, passwordHash: encodedHash }).strict(),
      )
      .max(100_000),
    memberships: z
      .array(
        z
          .object({
            userId: sourceAccountId,
            workspaceId: z.string().min(1).max(128),
            role: z.enum(["admin", "viewer"]),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .max(250_000),
  })
  .strict();
const postparticleSchema = z
  .object({
    organizationId: z.string().uuid(),
    users: z
      .array(
        z
          .object({
            username: z.string().min(1).max(254),
            email: userEmail.optional(),
            passwordHash: encodedHash,
            platformAdmin: z.boolean().optional(),
            disabled: z.boolean().optional(),
          })
          .strict(),
      )
      .max(100_000),
    memberships: z
      .array(
        z
          .object({
            username: z.string().min(1).max(254),
            projectId: z.string().min(1).max(128),
            role: z.enum(["admin", "editor", "viewer"]).nullable(),
          })
          .strict(),
      )
      .max(250_000),
  })
  .strict();
const importSchema = z
  .object({
    dryRun: z.boolean(),
    visitoring: visitoringSchema.optional(),
    postparticle: postparticleSchema.optional(),
    credentialSelections: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((value) => !!value.visitoring || !!value.postparticle);

function authorizedMigrationRequest(request: Request): boolean {
  const expected = process.env.PERMINISTER_LEGACY_IMPORT_SECRET?.trim() ?? "";
  const supplied = request.headers.get("x-perminister-migration-secret") ?? "";
  if (expected.length < 32 || !supplied) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

export async function POST(request: Request) {
  if ((process.env.PERMINISTER_LEGACY_IMPORT_SECRET?.trim().length ?? 0) < 32) {
    return Response.json(
      { error: "Legacy account import is not configured." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (!authorizedMigrationRequest(request)) {
    return Response.json(
      { error: "Invalid migration credentials." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!isJsonRequest(request)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: NO_STORE_HEADERS },
    );
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, 25 * 1024 * 1024);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? "Import body is too large."
            : "Import body must be valid JSON.",
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: NO_STORE_HEADERS },
    );
  }
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Provide a valid legacy import manifest.",
        details: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  let visitoringConfigured = false;
  let postparticleConfigured = false;
  try {
    [visitoringConfigured, postparticleConfigured] = await Promise.all([
      parsed.data.visitoring ? hasActiveConsumerClientForProduct("visitoring") : false,
      parsed.data.postparticle ? hasActiveConsumerClientForProduct("postparticle") : false,
    ]);
  } catch {
    return Response.json(
      { error: "Consumer client registry is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (
    (parsed.data.visitoring && !visitoringConfigured) ||
    (parsed.data.postparticle && !postparticleConfigured)
  ) {
    return Response.json(
      { error: "Configure the corresponding consumer clients before importing accounts." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const report = await importLegacyAuthData(
      parsed.data as LegacyAuthImportInput,
      {
        ...(parsed.data.visitoring ? { visitoringProductId: "visitoring" } : {}),
        ...(parsed.data.postparticle ? { postparticleProductId: "postparticle" } : {}),
      },
      parsed.data.dryRun,
    );
    const status =
      !parsed.data.dryRun && report.conflicts.length > 0
        ? 409
        : report.errors.length > 0
          ? 400
          : 200;
    return Response.json(report, { status, headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { error: "Legacy account import is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
