import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("consumer client settings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("PERMINISTER_APP_CLIENT_IDS", "visitoring,postparticle");
    vi.stubEnv("PERMINISTER_APP_CLIENT_VISITORING_SECRET", "v".repeat(40));
    vi.stubEnv("PERMINISTER_APP_CLIENT_POSTPARTICLE_SECRET", "p".repeat(40));
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses the required product session defaults and disables first-party registration", async () => {
    const { getConsumerClient } = await import("../../src/lib/auth/consumer-clients");

    expect(getConsumerClient("visitoring")).toMatchObject({
      sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
      selfRegistrationEnabled: false,
    });
    expect(getConsumerClient("postparticle")).toMatchObject({
      sessionLifetimeMs: 8 * 60 * 60 * 1000,
      selfRegistrationEnabled: false,
    });
  });

  it("accepts bounded session overrides without enabling first-party registration", async () => {
    vi.stubEnv("PERMINISTER_APP_CLIENT_VISITORING_SESSION_LIFETIME_SECONDS", "3600");
    vi.stubEnv("PERMINISTER_APP_CLIENT_VISITORING_SELF_REGISTRATION_ENABLED", "true");
    const { getConsumerClient } = await import("../../src/lib/auth/consumer-clients");
    expect(getConsumerClient("visitoring")).toMatchObject({
      sessionLifetimeMs: 60 * 60 * 1000,
      selfRegistrationEnabled: false,
    });

    vi.stubEnv("PERMINISTER_APP_CLIENT_VISITORING_SESSION_LIFETIME_SECONDS", "30");
    expect(getConsumerClient("visitoring")).toBeNull();
  });

  it("rejects unconfigured or incorrect client credentials", async () => {
    const { authenticateConsumerClient } = await import("../../src/lib/auth/consumer-clients");
    const validRequest = new Request("https://perminister.example/api", {
      headers: {
        "x-perminister-client-id": "visitoring",
        "x-perminister-client-secret": "v".repeat(40),
      },
    });
    const invalidRequest = new Request("https://perminister.example/api", {
      headers: {
        "x-perminister-client-id": "visitoring",
        "x-perminister-client-secret": "incorrect",
      },
    });
    expect(authenticateConsumerClient(validRequest)?.clientId).toBe("visitoring");
    expect(authenticateConsumerClient(invalidRequest)).toBeNull();
  });
});
