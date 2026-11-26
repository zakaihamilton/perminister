import { createCipheriv } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ importSentry8LegacyMemberships: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/service", () => ({
  importSentry8LegacyMemberships: mocks.importSentry8LegacyMemberships,
}));

import { POST } from "@/app/api/auth/sentry8-import/route";

const key = Buffer.alloc(32, 7);
const migrationSecret = "m".repeat(40);
const membership = {
  sentry8UserId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  projectSlug: "default",
  projectName: "Default",
  organizationId: "33333333-3333-4333-8333-333333333333",
  productId: "sentry8",
  resourceId: "44444444-4444-4444-8444-444444444444",
  resourceUri: "https://sentry8.example/mcp/default",
  email: "person@example.com",
  displayName: "Person",
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$dmVyaWZpZXI",
  perministerSubjectId: null,
  role: "viewer",
  status: "active",
  perministerRole: "viewer",
};

function encryptedEnvelope(apply: boolean) {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify({
    format: "sentry8-perminister-user-migration/v1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    memberships: [membership],
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    format: "sentry8-perminister-encrypted/v1",
    algorithm: "aes-256-gcm",
    apply,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function request(body: unknown, secret = migrationSecret) {
  return new Request("https://perminister.example/api/auth/sentry8-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-perminister-migration-secret": secret,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/sentry8-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PERMINISTER_ENABLE_SENTRY8_IMPORT", "true");
    vi.stubEnv("PERMINISTER_SENTRY8_IMPORT_SECRET", migrationSecret);
    vi.stubEnv("PERMINISTER_SENTRY8_IMPORT_ENCRYPTION_KEY", key.toString("base64url"));
    mocks.importSentry8LegacyMemberships.mockResolvedValue({
      total: 1,
      created: 1,
      linked: 0,
      memberships: 1,
      applied: false,
      conflicts: [],
      subjectMappings: [],
    });
  });

  it("decrypts a dry-run manifest without changing apply state", async () => {
    const response = await POST(request(encryptedEnvelope(false)));

    expect(response.status).toBe(200);
    expect(mocks.importSentry8LegacyMemberships).toHaveBeenCalledWith(
      [membership],
      false,
    );
  });

  it("passes an explicitly applied manifest to the importer", async () => {
    const response = await POST(request(encryptedEnvelope(true)));

    expect(response.status).toBe(200);
    expect(mocks.importSentry8LegacyMemberships).toHaveBeenCalledWith(
      [membership],
      true,
    );
  });

  it("rejects an invalid migration secret without invoking the importer", async () => {
    const response = await POST(request(encryptedEnvelope(false), "wrong"));

    expect(response.status).toBe(404);
    expect(mocks.importSentry8LegacyMemberships).not.toHaveBeenCalled();
  });

  it("rejects tampered ciphertext before importing", async () => {
    const envelope = encryptedEnvelope(false);
    envelope.tag = Buffer.alloc(16, 1).toString("base64url");

    const response = await POST(request(envelope));

    expect(response.status).toBe(400);
    expect(mocks.importSentry8LegacyMemberships).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.unstubAllEnvs());
