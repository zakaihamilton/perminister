import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateClient: vi.fn(),
  exchangeCode: vi.fn(),
  signingReady: vi.fn(),
  signIdToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/performance", () => ({
  withApiRoutePerformance: (_label: string, handler: (request: Request) => unknown) => handler,
}));
vi.mock("@/lib/auth/consumer-clients", () => ({
  authenticateConsumerClientBasic: mocks.authenticateClient,
}));
vi.mock("@/lib/auth/service", () => ({
  exchangeConsumerAuthorizationCode: mocks.exchangeCode,
  InvalidConsumerAuthorizationCodeError: class InvalidConsumerAuthorizationCodeError extends Error {},
}));
vi.mock("@/lib/auth/oidc", () => ({
  assertOidcSigningKeyReady: mocks.signingReady,
  signOidcIdToken: mocks.signIdToken,
}));

import { POST } from "@/app/oauth/token/route";
import { InvalidConsumerAuthorizationCodeError } from "@/lib/auth/service";

const clientId = "11111111-1111-4111-8111-111111111111";
const callback = "https://postparticle.example/auth/perminister/callback";

function tokenRequest(overrides: Record<string, string> = {}, duplicates = false): Request {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "authorization-code",
    code_verifier: "v".repeat(43),
    redirect_uri: callback,
    ...overrides,
  });
  if (duplicates) body.append("code", "second-code");
  return new Request("https://perminister.example/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:app-secret`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateClient.mockResolvedValue({ clientId });
  mocks.exchangeCode.mockResolvedValue({
    token: "opaque-app-bound-access-token",
    session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    nonce: "n".repeat(43),
    scope: "openid profile email perminister_api",
    subject: { subjectId: "22222222-2222-4222-8222-222222222222" },
  });
  mocks.signIdToken.mockReturnValue("signed-id-token");
});

describe("OIDC token endpoint", () => {
  it("authenticates the client and returns an app-bound token with an ID token", async () => {
    const request = tokenRequest();
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access_token: "opaque-app-bound-access-token",
      token_type: "Bearer",
      scope: "openid profile email perminister_api",
      id_token: "signed-id-token",
    });
    expect(mocks.authenticateClient).toHaveBeenCalledWith(request);
    expect(mocks.exchangeCode).toHaveBeenCalledWith(
      "authorization-code",
      clientId,
      "v".repeat(43),
      callback,
    );
    expect(mocks.signIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId, nonce: "n".repeat(43) }),
    );
  });

  it("rejects duplicate codes and secrets passed outside client_secret_basic", async () => {
    expect((await POST(tokenRequest({}, true))).status).toBe(400);
    expect((await POST(tokenRequest({ client_secret: "app-secret" }))).status).toBe(400);
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects an incorrect body client ID before exchanging the code", async () => {
    const response = await POST(tokenRequest({ client_id: "33333333-3333-4333-8333-333333333333" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_client" });
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("returns invalid_grant for expired, replayed, or PKCE-mismatched codes", async () => {
    mocks.exchangeCode.mockRejectedValue(new InvalidConsumerAuthorizationCodeError());
    const response = await POST(tokenRequest());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
  });
});
