import "server-only";

import { createPrivateKey, createPublicKey, sign as signBytes, type KeyObject } from "node:crypto";

const OIDC_SCOPES = ["openid", "profile", "email", "perminister_api"] as const;
const PRIVATE_JWK_FIELDS = new Set(["d", "p", "q", "dp", "dq", "qi", "oth"]);
const encoder = new TextEncoder();

type JsonMap = Record<string, unknown>;
type PublicJwk = {
  alg: "RS256";
  e: string;
  kid: string;
  kty: "RSA";
  n: string;
  use: "sig";
};

type SigningConfig = {
  issuer: string;
  kid: string;
  privateKey: KeyObject;
  jwks: { keys: PublicJwk[] };
};

function decodeJsonObject(value: string, message: string): JsonMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(message);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(message);
  }
  return parsed as JsonMap;
}

function safeIssuer(): string {
  const raw = process.env.PERMINISTER_OIDC_ISSUER?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PERMINISTER_OIDC_ISSUER must be an absolute origin.");
  }
  const localHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PERMINISTER_OIDC_ISSUER must be an HTTPS origin.");
  }
  return url.origin;
}

function publicJwk(value: unknown): PublicJwk {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Perminister OIDC public signing key.");
  }
  const key = value as JsonMap;
  if (
    key.kty !== "RSA" ||
    typeof key.kid !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(key.kid) ||
    typeof key.n !== "string" ||
    typeof key.e !== "string" ||
    (key.alg !== undefined && key.alg !== "RS256") ||
    (key.use !== undefined && key.use !== "sig")
  ) {
    throw new Error("Invalid Perminister OIDC public signing key.");
  }
  for (const field of PRIVATE_JWK_FIELDS) {
    if (field in key) throw new Error("A private key was found in the public JWKS setting.");
  }
  const candidate: PublicJwk = {
    alg: "RS256",
    e: key.e,
    kid: key.kid,
    kty: "RSA",
    n: key.n,
    use: "sig",
  };
  if (Buffer.from(candidate.n, "base64url").byteLength < 256) {
    throw new Error("Perminister OIDC signing keys must be at least 2048 bits.");
  }
  try {
    createPublicKey({ key: candidate as never, format: "jwk" });
  } catch {
    throw new Error("Invalid Perminister OIDC public signing key.");
  }
  return candidate;
}

function publicKeys(): PublicJwk[] {
  const raw = process.env.PERMINISTER_OIDC_PUBLIC_JWKS?.trim() ?? "";
  if (!raw) throw new Error("PERMINISTER_OIDC_PUBLIC_JWKS is not configured.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PERMINISTER_OIDC_PUBLIC_JWKS must be a JSON array.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("PERMINISTER_OIDC_PUBLIC_JWKS must be a non-empty JSON array.");
  }
  const keys = parsed.map(publicJwk);
  if (new Set(keys.map((key) => key.kid)).size !== keys.length) {
    throw new Error("Perminister OIDC JWKS contains duplicate key IDs.");
  }
  return keys;
}

function signingConfig(): SigningConfig {
  const rawPrivateJwk = process.env.PERMINISTER_OIDC_PRIVATE_JWK?.trim() ?? "";
  if (!rawPrivateJwk) {
    throw new Error("PERMINISTER_OIDC_PRIVATE_JWK is not configured.");
  }
  const privateJwk = decodeJsonObject(
    rawPrivateJwk,
    "PERMINISTER_OIDC_PRIVATE_JWK must contain a private RSA JWK.",
  );
  if (
    privateJwk.kty !== "RSA" ||
    typeof privateJwk.kid !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(privateJwk.kid) ||
    typeof privateJwk.n !== "string" ||
    typeof privateJwk.e !== "string" ||
    typeof privateJwk.d !== "string" ||
    typeof privateJwk.p !== "string" ||
    typeof privateJwk.q !== "string" ||
    typeof privateJwk.dp !== "string" ||
    typeof privateJwk.dq !== "string" ||
    typeof privateJwk.qi !== "string"
  ) {
    throw new Error("PERMINISTER_OIDC_PRIVATE_JWK must contain a complete private RSA JWK.");
  }
  if (Buffer.from(privateJwk.n, "base64url").byteLength < 256) {
    throw new Error("Perminister OIDC signing keys must be at least 2048 bits.");
  }

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: privateJwk as never, format: "jwk" });
  } catch {
    throw new Error("PERMINISTER_OIDC_PRIVATE_JWK is not a valid private RSA key.");
  }

  const keys = publicKeys();
  const active = keys.find((key) => key.kid === privateJwk.kid);
  if (!active || active.n !== privateJwk.n || active.e !== privateJwk.e) {
    throw new Error("The active OIDC private key does not match the published JWKS.");
  }

  return { issuer: safeIssuer(), kid: active.kid, privateKey, jwks: { keys } };
}

export function assertOidcSigningKeyReady(): void {
  signingConfig();
}

export function getOidcIssuer(): string {
  return safeIssuer();
}

export function getConfiguredOidcIssuer(): string | null {
  try {
    return safeIssuer();
  } catch {
    return null;
  }
}

export function getOidcJwks(): { keys: PublicJwk[] } {
  return { keys: publicKeys() };
}

export function getOidcDiscoveryDocument() {
  const issuer = safeIssuer();
  return {
    issuer,
    authorization_endpoint: new URL("/oauth/authorize", issuer).toString(),
    token_endpoint: new URL("/oauth/token", issuer).toString(),
    registration_endpoint: new URL("/oauth/register", issuer).toString(),
    jwks_uri: new URL("/.well-known/jwks.json", issuer).toString(),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    authorization_response_iss_parameter_supported: true,
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: [...OIDC_SCOPES],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: [
      "iss",
      "sub",
      "aud",
      "exp",
      "iat",
      "auth_time",
      "nonce",
      "email",
      "email_verified",
      "name",
      "given_name",
      "family_name",
    ],
  };
}

export function getOAuthAuthorizationServerMetadata() {
  const issuer = safeIssuer();
  return {
    issuer,
    authorization_endpoint: new URL("/oauth/authorize", issuer).toString(),
    token_endpoint: new URL("/oauth/token", issuer).toString(),
    introspection_endpoint: new URL("/oauth/introspect", issuer).toString(),
    registration_endpoint: new URL("/oauth/register", issuer).toString(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    introspection_endpoint_auth_methods_supported: ["client_secret_basic"],
    registration_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    resource_parameter_supported: true,
  };
}

export function signOidcIdToken(input: {
  clientId: string;
  nonce: string;
  subject: {
    subjectId: string;
    primaryEmail: string | null;
    emailVerifiedAt: string | null;
    emailVerificationExempt?: boolean;
    firstName?: string;
    lastName?: string;
  };
}): string {
  const config = signingConfig();
  const now = Math.floor(Date.now() / 1000);
  const payload: JsonMap = {
    iss: config.issuer,
    sub: input.subject.subjectId,
    aud: input.clientId,
    iat: now,
    exp: now + 300,
    auth_time: now,
    nonce: input.nonce,
  };
  if (input.subject.primaryEmail) {
    payload.email = input.subject.primaryEmail;
    payload.email_verified =
      Boolean(input.subject.emailVerifiedAt) || input.subject.emailVerificationExempt === true;
  }
  const givenName = input.subject.firstName?.trim();
  const familyName = input.subject.lastName?.trim();
  if (givenName) payload.given_name = givenName;
  if (familyName) payload.family_name = familyName;
  if (givenName || familyName) payload.name = [givenName, familyName].filter(Boolean).join(" ");

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT", kid: config.kid });
  const body = encode(payload);
  const signingInput = header + "." + body;
  const signature = signBytes("RSA-SHA256", encoder.encode(signingInput), config.privateKey);
  return signingInput + "." + signature.toString("base64url");
}
