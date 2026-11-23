import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSUMER_OIDC_SCOPE,
  consumerAuthorizationQuery,
  legacyConsumerAuthorizationEnabled,
  parseConsumerAuthorizationRequest,
} from "../../src/lib/auth/consumer-sso";
import type { ConsumerClientRecord } from "../../src/lib/auth/domain";

const clientId = "11111111-1111-4111-8111-111111111111" as ConsumerClientRecord["consumerClientId"];
const redirectUri = "https://postparticle.example/auth/perminister/callback";
const client = {
  kind: "consumer-client",
  schemaVersion: 1,
  consumerClientId: clientId,
  productId: "postparticle",
  appName: "PostParticle",
  appOrigin: "https://postparticle.example",
  sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
  selfRegistrationEnabled: false,
  verifier: { algorithm: "sha256", digestHex: "a".repeat(64) },
  status: "active",
  createdBySubjectId: "22222222-2222-4222-8222-222222222222" as ConsumerClientRecord["createdBySubjectId"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  revokedAt: null,
} satisfies ConsumerClientRecord;
const legacyClient = {
  ...client,
  productId: "visitoring",
  appName: "Visitoring",
  appOrigin: "https://visitoring.example",
} satisfies ConsumerClientRecord;

function request(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CONSUMER_OIDC_SCOPE,
    state: "s".repeat(43),
    nonce: "n".repeat(43),
    code_challenge: "c".repeat(43),
    code_challenge_method: "S256",
    ...overrides,
  });
}

function legacyRequest(
  appOrigin = legacyClient.appOrigin,
  overrides: Record<string, string> = {},
): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appOrigin}/auth/perminister/callback`,
    response_type: "code",
    state: "s".repeat(43),
    code_challenge: "c".repeat(43),
    code_challenge_method: "S256",
    ...overrides,
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("consumer OIDC authorization requests", () => {
  it("accepts only the active client's exact callback and the full OIDC request", () => {
    expect(parseConsumerAuthorizationRequest(request(), client)).toMatchObject({
      clientId,
      redirectUri,
      state: "s".repeat(43),
      nonce: "n".repeat(43),
      scope: CONSUMER_OIDC_SCOPE,
      prompt: null,
      codeChallenge: "c".repeat(43),
    });
  });

  it.each([
    ["missing state", { state: "" }],
    ["missing nonce", { nonce: "" }],
    ["missing openid scope", { scope: "profile email perminister_api" }],
    ["unsupported scope", { scope: "openid profile email admin" }],
    ["wrong PKCE method", { code_challenge_method: "plain" }],
    ["malformed challenge", { code_challenge: "short" }],
    ["unknown prompt", { prompt: "none" }],
    ["callback path change", { redirect_uri: "https://postparticle.example/other" }],
    ["callback origin change", { redirect_uri: "https://attacker.example/auth/perminister/callback" }],
  ])("rejects a request with %s", (_label, overrides) => {
    expect(parseConsumerAuthorizationRequest(request(overrides), client)).toBeNull();
  });

  it("rejects duplicate security parameters and disabled clients", () => {
    const duplicate = request();
    duplicate.append("state", "other-state");
    expect(parseConsumerAuthorizationRequest(duplicate, client)).toBeNull();
    expect(parseConsumerAuthorizationRequest(request(), { ...client, status: "revoked" })).toBeNull();
  });

  it("preserves state, nonce, scope, and prompt through the confirmation redirect", () => {
    const parsed = parseConsumerAuthorizationRequest(request({ prompt: "login" }), client);
    expect(parsed).not.toBeNull();
    const query = new URLSearchParams(consumerAuthorizationQuery(parsed!));
    expect(query.get("state")).toBe("s".repeat(43));
    expect(query.get("nonce")).toBe("n".repeat(43));
    expect(query.get("scope")).toBe(CONSUMER_OIDC_SCOPE);
    expect(query.get("prompt")).toBe("login");
  });

  it("accepts the old code request only when temporary compatibility is enabled", () => {
    const params = legacyRequest();
    expect(parseConsumerAuthorizationRequest(params, legacyClient)).toBeNull();

    const parsed = parseConsumerAuthorizationRequest(params, legacyClient, { allowLegacy: true });
    expect(parsed).toMatchObject({
      clientId,
      redirectUri: "https://visitoring.example/auth/perminister/callback",
      state: "s".repeat(43),
      nonce: null,
      scope: null,
      codeChallenge: "c".repeat(43),
    });
  });

  it("preserves the legacy request shape through the login and confirmation redirects", () => {
    const parsed = parseConsumerAuthorizationRequest(legacyRequest(), legacyClient, {
      allowLegacy: true,
    });
    expect(parsed).not.toBeNull();
    const query = new URLSearchParams(consumerAuthorizationQuery(parsed!));
    expect(query.has("nonce")).toBe(false);
    expect(query.has("scope")).toBe(false);
    expect(query.get("state")).toBe("s".repeat(43));
    expect(query.get("code_challenge_method")).toBe("S256");
  });

  it.each([
    ["only nonce", { nonce: "n".repeat(43) }],
    ["only scope", { scope: CONSUMER_OIDC_SCOPE }],
    ["malformed state", { state: "bad" }],
    ["malformed challenge", { code_challenge: "bad" }],
    ["wrong PKCE method", { code_challenge_method: "plain" }],
    ["wrong callback", { redirect_uri: "https://postparticle.example/not-callback" }],
  ])("rejects legacy compatibility request with %s", (_label, overrides) => {
    expect(
      parseConsumerAuthorizationRequest(legacyRequest(legacyClient.appOrigin, overrides), legacyClient, {
        allowLegacy: true,
      }),
    ).toBeNull();
  });

  it("rejects legacy compatibility requests for revoked clients", () => {
    expect(
      parseConsumerAuthorizationRequest(legacyRequest(), { ...legacyClient, status: "revoked" }, {
        allowLegacy: true,
      }),
    ).toBeNull();
  });

  it("keeps other products on the strict OIDC request even when compatibility is enabled", () => {
    const otherProduct = { ...legacyClient, productId: "postparticle" };
    expect(
      parseConsumerAuthorizationRequest(legacyRequest(), otherProduct, { allowLegacy: true }),
    ).toBeNull();
  });

  it.each([
    ["visitoring", "https://visitoring.example"],
    ["nanogres", "https://nanogres.example"],
  ])("accepts legacy requests for %s only with an active client", (productId, appOrigin) => {
    const appClient = { ...legacyClient, productId, appOrigin };
    expect(
      parseConsumerAuthorizationRequest(legacyRequest(appOrigin), appClient, { allowLegacy: true }),
    ).not.toBeNull();
  });

  it("reads the temporary compatibility flag from the environment", () => {
    vi.stubEnv("PERMINISTER_ENABLE_LEGACY_CONSUMER_OAUTH", "false");
    expect(legacyConsumerAuthorizationEnabled()).toBe(false);
    vi.stubEnv("PERMINISTER_ENABLE_LEGACY_CONSUMER_OAUTH", "true");
    expect(legacyConsumerAuthorizationEnabled()).toBe(true);
  });
});
