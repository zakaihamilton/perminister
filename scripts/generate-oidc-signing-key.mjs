import { generateKeyPairSync, randomBytes } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicExponent: 0x10001,
});
const privateJwk = privateKey.export({ format: "jwk" });
const kid = randomBytes(16).toString("base64url");
const publicJwk = {
  alg: "RS256",
  e: privateJwk.e,
  kid,
  kty: "RSA",
  n: privateJwk.n,
  use: "sig",
};
Object.assign(privateJwk, { alg: "RS256", kid, use: "sig" });
console.log("PERMINISTER_OIDC_PRIVATE_JWK=" + JSON.stringify(privateJwk));
console.log("PERMINISTER_OIDC_PUBLIC_JWKS=" + JSON.stringify([publicJwk]));
