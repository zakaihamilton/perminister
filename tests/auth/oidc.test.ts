import { generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertOidcSigningKeyReady,
  getOidcDiscoveryDocument,
  getOidcJwks,
  signOidcIdToken,
} from "../../src/lib/auth/oidc";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "perminister-test-key";
const publicJwk = {
  ...(publicKey.export({ format: "jwk" }) as Record<string, string>),
  alg: "RS256",
  kid,
  use: "sig",
};
const privateJwk = {
  ...(privateKey.export({ format: "jwk" }) as Record<string, string>),
  kid,
};

function configure() {
  vi.stubEnv("PERMINISTER_OIDC_ISSUER", "https://perminister.example");
  vi.stubEnv("PERMINISTER_OIDC_PUBLIC_JWKS", JSON.stringify([publicJwk]));
  vi.stubEnv("PERMINISTER_OIDC_PRIVATE_JWK", JSON.stringify(privateJwk));
}

afterEach(() => vi.unstubAllEnvs());

describe("Perminister OpenID provider", () => {
  it("publishes discovery metadata for the supported OIDC flow", () => {
    vi.stubEnv("PERMINISTER_OIDC_ISSUER", "https://perminister.example");
    expect(getOidcDiscoveryDocument()).toMatchObject({
      issuer: "https://perminister.example",
      authorization_endpoint: "https://perminister.example/oauth/authorize",
      token_endpoint: "https://perminister.example/oauth/token",
      jwks_uri: "https://perminister.example/.well-known/jwks.json",
      response_types_supported: ["code"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("publishes only public keys and signs an RS256 ID token with the request nonce", () => {
    configure();
    assertOidcSigningKeyReady();
    expect(getOidcJwks()).toEqual({ keys: [publicJwk] });
    expect(JSON.stringify(getOidcJwks())).not.toContain('"d"');

    const idToken = signOidcIdToken({
      clientId: "11111111-1111-4111-8111-111111111111",
      nonce: "n".repeat(43),
      scopes: ["openid", "profile", "email", "perminister_api"],
      subject: {
        subjectId: "22222222-2222-4222-8222-222222222222",
        primaryEmail: "person@example.com",
        emailVerifiedAt: new Date().toISOString(),
        firstName: "Ari",
        lastName: "Example",
      },
    });
    const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader!, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid });
    expect(payload).toMatchObject({
      iss: "https://perminister.example",
      aud: "11111111-1111-4111-8111-111111111111",
      nonce: "n".repeat(43),
      email: "person@example.com",
      email_verified: true,
      name: "Ari Example",
    });
    expect(
      verifySignature(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        publicKey,
        Buffer.from(encodedSignature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("fails closed when the private key does not match a published key", () => {
    configure();
    const otherPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv(
      "PERMINISTER_OIDC_PRIVATE_JWK",
      JSON.stringify({ ...(otherPair.privateKey.export({ format: "jwk" }) as object), kid }),
    );
    expect(() => assertOidcSigningKeyReady()).toThrow(/does not match the published JWKS/);
  });
});
