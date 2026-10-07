import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getConsumerClientRecord: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/auth/service", () => ({
  getConsumerClientRecord: mocks.getConsumerClientRecord,
}));

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_SECRET = "pmc_test_secret_with_sufficient_entropy";

function clientRecord(status: "active" | "revoked" = "active") {
  const now = new Date().toISOString();
  return {
    kind: "consumer-client",
    schemaVersion: 1,
    consumerClientId: CLIENT_ID,
    productId: "visitoring",
    appName: "Visitoring",
    appOrigin: "https://visitoring.example.com",
    sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
    selfRegistrationEnabled: false,
    verifier: {
      algorithm: "sha256",
      digestHex: createHash("sha256").update(CLIENT_SECRET).digest("hex"),
    },
    status,
    createdBySubjectId: "22222222-2222-4222-8222-222222222222",
    createdAt: now,
    updatedAt: now,
    revokedAt: status === "revoked" ? now : null,
  };
}

describe("consumer client credentials", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getConsumerClientRecord.mockImplementation(async (clientId: string) =>
      clientId === CLIENT_ID ? clientRecord() : null,
    );
  });

  afterEach(() => vi.clearAllMocks());

  it("loads product settings from the dynamic client record", async () => {
    const { getConsumerClient } = await import("../../src/lib/auth/consumer-clients");

    await expect(getConsumerClient(CLIENT_ID)).resolves.toMatchObject({
      clientId: CLIENT_ID,
      productId: "visitoring",
      sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
      selfRegistrationEnabled: false,
    });
    expect(mocks.getConsumerClientRecord).toHaveBeenCalledWith(CLIENT_ID);
  });

  it("authenticates with the stored verifier and rejects incorrect or revoked credentials", async () => {
    const { authenticateConsumerClient } = await import("../../src/lib/auth/consumer-clients");
    const validRequest = new Request("https://perminister.example/api", {
      headers: {
        "x-perminister-client-id": CLIENT_ID,
        "x-perminister-client-secret": CLIENT_SECRET,
      },
    });
    const invalidRequest = new Request("https://perminister.example/api", {
      headers: {
        "x-perminister-client-id": CLIENT_ID,
        "x-perminister-client-secret": "incorrect",
      },
    });

    await expect(authenticateConsumerClient(validRequest)).resolves.toMatchObject({
      clientId: CLIENT_ID,
    });
    await expect(authenticateConsumerClient(invalidRequest)).resolves.toBeNull();

    mocks.getConsumerClientRecord.mockResolvedValue(clientRecord("revoked"));
    await expect(authenticateConsumerClient(validRequest)).resolves.toBeNull();
  });

  it("rejects malformed or unknown client IDs", async () => {
    const { getConsumerClient } = await import("../../src/lib/auth/consumer-clients");

    await expect(getConsumerClient("visitoring")).resolves.toBeNull();
    await expect(getConsumerClient("33333333-3333-4333-8333-333333333333")).resolves.toBeNull();
  });
});
