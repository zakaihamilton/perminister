import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
  createConsumerAuthorizationCode: vi.fn(),
  getOAuthAuthorizationClient: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/service", () => ({
  createConsumerAuthorizationCode: mocks.createConsumerAuthorizationCode,
  getOAuthAuthorizationClient: mocks.getOAuthAuthorizationClient,
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/components/authorization-view", () => ({
  AuthorizationView: ({ error }: { error: string }) => ({ error }),
}));

import ConsumerAuthorizationPage from "@/app/oauth/authorize/page";

const clientId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const state = "s".repeat(43);
const nonce = "n".repeat(43);
const challenge = "c".repeat(43);
const redirectUri = "https://postparticle.example/auth/perminister/callback";
const client = {
  consumerClientId: clientId,
  productId: "postparticle",
  appName: "PostParticle",
  appOrigin: "https://postparticle.example",
  status: "active",
};

function oauthAuthorizationClient(profile = client) {
  return {
    oauthClientId: profile.consumerClientId,
    oauthClientType: "confidential" as const,
    clientName: profile.appName,
    profile,
    redirectUris: [new URL("/auth/perminister/callback", profile.appOrigin).toString()],
    registrationScopes: null,
  };
}

function request(prompt?: string) {
  return {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    nonce,
    scope: "openid profile email perminister_api",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(prompt ? { prompt } : {}),
  };
}

describe("consumer authorization page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOAuthAuthorizationClient.mockResolvedValue(oauthAuthorizationClient(client));
    mocks.getCurrentSession.mockResolvedValue({ subject: { subjectId } });
    mocks.createConsumerAuthorizationCode.mockResolvedValue("issued-code");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("issues the authorization code and returns directly to the registered product callback", async () => {
    await expect(
      ConsumerAuthorizationPage({ searchParams: Promise.resolve(request()) }),
    ).rejects.toThrow(`redirect:${redirectUri}?code=issued-code&state=${state}`);

    expect(mocks.createConsumerAuthorizationCode).toHaveBeenCalledWith(
      subjectId,
      clientId,
      challenge,
      nonce,
      redirectUri,
      "openid profile email perminister_api",
    );
  });

  it("sends an unauthenticated request through Perminister login first", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);

    await expect(
      ConsumerAuthorizationPage({ searchParams: Promise.resolve(request()) }),
    ).rejects.toThrow(/^redirect:\/login\?next=/);
    expect(mocks.createConsumerAuthorizationCode).not.toHaveBeenCalled();
  });

  it("preserves prompt=login by requiring a fresh Perminister sign-in", async () => {
    await expect(
      ConsumerAuthorizationPage({ searchParams: Promise.resolve(request("login")) }),
    ).rejects.toThrow(/^redirect:\/login\?next=/);
    expect(mocks.createConsumerAuthorizationCode).not.toHaveBeenCalled();
  });

  it("shows an error instead of retrying indefinitely when code issuance fails", async () => {
    const result = await ConsumerAuthorizationPage({
      searchParams: Promise.resolve({ ...request(), error: "unavailable" }),
    });

    expect(result).toMatchObject({ props: { error: "unavailable" } });
    expect(mocks.createConsumerAuthorizationCode).not.toHaveBeenCalled();
  });
});
