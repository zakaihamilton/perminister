import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";
import { hasActiveConsumerClientForProduct, importLegacyAuthData } from "@/lib/auth/service";

export const runtime = "nodejs";

const sourceAccountId = z.string().trim().min(1).max(254);
const userEmail = z.email().max(254);
const encodedHash = z.string().min(1).max(4096);
const productSchema = z
  .object({
    productId: z.string().trim().min(1).max(128),
    organizationId: z.string().uuid(),
    hashFormat: z.enum(["argon2id-phc", "legacy-scrypt-salt-hex-v1"]),
    users: z
      .array(
        z
          .object({
            accountId: sourceAccountId,
            username: z.string().trim().min(1).max(254).optional(),
            email: userEmail.optional(),
            passwordHash: encodedHash,
            platformAdmin: z.boolean().optional(),
            disabled: z.boolean().optional(),
          })
          .strict()
          .refine((user) => !!user.email || !!user.username),
      )
      .max(100_000),
    memberships: z
      .array(
        z
          .object({
            accountId: sourceAccountId,
            scopeKind: z.enum(["workspace", "project"]),
            resourceId: z.string().min(1).max(128),
            role: z.string().trim().min(1).max(32).nullable(),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .max(250_000),
  })
  .strict();
const importSchema = z
  .object({
    dryRun: z.boolean(),
    products: z.array(productSchema).max(100),
    credentialSelections: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((value) => value.products.length > 0);

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
      { error: "Account import is not configured." },
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
        error: "Provide a valid account import manifest.",
        details: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  let clientsConfigured: boolean[];
  try {
    clientsConfigured = await Promise.all(
      parsed.data.products.map((product) => hasActiveConsumerClientForProduct(product.productId)),
    );
  } catch {
    return Response.json(
      { error: "Consumer client registry is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (clientsConfigured.some((configured) => !configured)) {
    return Response.json(
      { error: "Configure a consumer client for each product before importing accounts." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const report = await importLegacyAuthData(parsed.data, parsed.data.dryRun);
    const status =
      !parsed.data.dryRun && report.conflicts.length > 0
        ? 409
        : report.errors.length > 0
          ? 400
          : 200;
    return Response.json(report, { status, headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { error: "Account import is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
