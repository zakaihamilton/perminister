import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createConsumerSession: vi.fn(),
  listConsumerOrganizationsForSubject: vi.fn(),
  client: {
    clientId: "11111111-1111-4111-8111-111111111111",
    productId: "visitoring",
    sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/service", () => ({
  authenticate: mocks.authenticate,
  createConsumerSession: mocks.createConsumerSession,
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
    mocks.authenticate.mockResolvedValue(subject);
    mocks.createConsumerSession.mockResolvedValue({
      token: "opaque-session-token",
      session: { expiresAt: "2030-01-01T00:00:00.000Z" },
    });
    mocks.listConsumerOrganizationsForSubject.mockResolvedValue([]);
  });

  it("accepts an imported Visitoring password at its legacy maximum length", async () => {
    const password = "p".repeat(1024);
    const response = await POST(loginRequest(password));

    expect(response.status).toBe(200);
    expect(mocks.authenticate).toHaveBeenCalledWith("person@example.com", password, "visitoring");
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
});
