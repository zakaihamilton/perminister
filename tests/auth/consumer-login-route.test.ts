import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  consumeConsumerLoginRequestRateLimit: vi.fn(),
  createConsumerSession: vi.fn(),
  listConsumerOrganizationsForSubject: vi.fn(),
  client: {
    clientId: "11111111-1111-4111-8111-111111111111",
    productId: "sentry8",
    sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/service", () => ({
  authenticate: mocks.authenticate,
  consumeConsumerLoginRequestRateLimit: mocks.consumeConsumerLoginRequestRateLimit,
  createConsumerSession: mocks.createConsumerSession,
  isEmailVerifiedOrExemptForProduct: vi.fn(() => true),
  listConsumerOrganizationsForSubject: mocks.listConsumerOrganizationsForSubject,
}));
vi.mock("@/lib/auth/consumer-route", () => ({
  requireConsumerClientJsonBody: async (request: Request) => ({
    client: mocks.client,
    body: await request.json(),
  }),
}));

import { POST } from "@/app/api/auth/consumer/login/route";

const subject = {
  subjectId: "22222222-2222-4222-8222-222222222222",
  primaryEmail: "person@example.com",
  emailVerifiedAt: null,
  emailVerificationExempt: true,
  loginIdentifiers: [],
};

function loginRequest(password: string): Request {
  return new Request("https://perminister.example/api/auth/consumer/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "person@example.com", password }),
  });
}

describe("consumer login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.clientId = "11111111-1111-4111-8111-111111111111";
    mocks.client.productId = "sentry8";
    vi.stubEnv("PERMINISTER_ENABLE_SENTRY8_CONSUMER_PASSWORD_LOGIN", "true");
    vi.stubEnv("PERMINISTER_SENTRY8_CONSUMER_CLIENT_ID", mocks.client.clientId);
    mocks.authenticate.mockResolvedValue(subject);
    mocks.consumeConsumerLoginRequestRateLimit.mockResolvedValue(true);
    mocks.createConsumerSession.mockResolvedValue({
      token: "opaque-session-token",
      session: { expiresAt: "2030-01-01T00:00:00.000Z" },
    });
    mocks.listConsumerOrganizationsForSubject.mockResolvedValue([]);
  });

  it("keeps Sentry8 password login available only during an explicit rollout window", async () => {
    const password = "p".repeat(1024);
    const response = await POST(loginRequest(password));

    expect(response.status).toBe(200);
    expect(mocks.consumeConsumerLoginRequestRateLimit).toHaveBeenCalledWith(
      mocks.client.clientId,
      null,
    );
    expect(mocks.authenticate).toHaveBeenCalledWith("person@example.com", password, "sentry8");
    expect(await response.json()).toMatchObject({
      authenticated: true,
      sessionToken: "opaque-session-token",
    });
  });

  it("rejects login passwords above the legacy maximum before authentication", async () => {
    const response = await POST(loginRequest("p".repeat(1025)));

    expect(response.status).toBe(400);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("disables direct product password login when the rollout flag is off", async () => {
    vi.stubEnv("PERMINISTER_ENABLE_SENTRY8_CONSUMER_PASSWORD_LOGIN", "false");
    const response = await POST(loginRequest("secret"));

    expect(response.status).toBe(410);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("allows direct password login only for the configured Sentry8 client", async () => {
    mocks.client.clientId = "33333333-3333-4333-8333-333333333333";

    const response = await POST(loginRequest("secret"));

    expect(response.status).toBe(410);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("keeps the separate legacy rollout flag for other product clients", async () => {
    mocks.client.clientId = "33333333-3333-4333-8333-333333333333";
    mocks.client.productId = "visitoring";
    vi.stubEnv("PERMINISTER_ENABLE_LEGACY_CONSUMER_PASSWORD_LOGIN", "true");

    const response = await POST(loginRequest("secret"));

    expect(response.status).toBe(200);
    expect(mocks.authenticate).toHaveBeenCalledWith(
      "person@example.com",
      "secret",
      "visitoring",
    );
  });
});

afterEach(() => vi.unstubAllEnvs());
