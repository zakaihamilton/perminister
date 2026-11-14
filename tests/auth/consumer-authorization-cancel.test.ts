import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
  createConsumerAuthorizationCode: vi.fn(),
  getConsumerClientRecord: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/service", () => ({
  createConsumerAuthorizationCode: mocks.createConsumerAuthorizationCode,
  getConsumerClientRecord: mocks.getConsumerClientRecord,
  getCurrentSession: mocks.getCurrentSession,
}));

import {
  approveConsumerAuthorizationAction,
  cancelConsumerAuthorizationAction,
} from "@/app/oauth/authorize/action";

const clientId = "11111111-1111-4111-8111-111111111111";
const state = "s".repeat(43);
const client = {
  consumerClientId: clientId,
  productId: "postparticle",
  appOrigin: "https://postparticle.example",
  status: "active",
};

function authorizationForm() {
  const form = new FormData();
  form.set("client_id", clientId);
  form.set("redirect_uri", "https://postparticle.example/auth/perminister/callback");
  form.set("response_type", "code");
  form.set("state", state);
  form.set("nonce", "n".repeat(43));
  form.set("scope", "openid profile email perminister_api");
  form.set("code_challenge", "c".repeat(43));
  form.set("code_challenge_method", "S256");
  return form;
}

function legacyAuthorizationForm() {
  const form = new FormData();
  form.set("client_id", clientId);
  form.set("redirect_uri", "https://visitoring.example/auth/perminister/callback");
  form.set("response_type", "code");
  form.set("state", state);
  form.set("code_challenge", "c".repeat(43));
  form.set("code_challenge_method", "S256");
  return form;
}

describe("consumer authorization cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsumerClientRecord.mockResolvedValue(client);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns to the exact registered callback with the original state", async () => {
    await expect(cancelConsumerAuthorizationAction(authorizationForm())).rejects.toThrow(
      `redirect:https://postparticle.example/auth/perminister/callback?error=access_denied&state=${state}`,
    );
    expect(mocks.getConsumerClientRecord).toHaveBeenCalledWith(clientId);
  });

  it("cancels a legacy request when compatibility is enabled", async () => {
    vi.stubEnv("PERMINISTER_ENABLE_LEGACY_CONSUMER_OAUTH", "true");
    mocks.getConsumerClientRecord.mockResolvedValue({
      ...client,
      productId: "visitoring",
      appOrigin: "https://visitoring.example",
    });

    await expect(cancelConsumerAuthorizationAction(legacyAuthorizationForm())).rejects.toThrow(
      `redirect:https://visitoring.example/auth/perminister/callback?error=access_denied&state=${state}`,
    );
  });

  it("issues a code for a legacy request without adding empty OIDC fields", async () => {
    vi.stubEnv("PERMINISTER_ENABLE_LEGACY_CONSUMER_OAUTH", "true");
    mocks.getConsumerClientRecord.mockResolvedValue({
      ...client,
      productId: "visitoring",
      appOrigin: "https://visitoring.example",
    });
    mocks.getCurrentSession.mockResolvedValue({
      subject: { subjectId: "22222222-2222-4222-8222-222222222222" },
    });
    mocks.createConsumerAuthorizationCode.mockResolvedValue("code-value");

    await expect(approveConsumerAuthorizationAction(legacyAuthorizationForm())).rejects.toThrow(
      `redirect:https://visitoring.example/auth/perminister/callback?code=code-value&state=${state}`,
    );
    expect(mocks.createConsumerAuthorizationCode).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      clientId,
      "c".repeat(43),
      null,
      "https://visitoring.example/auth/perminister/callback",
      null,
    );
  });
});
