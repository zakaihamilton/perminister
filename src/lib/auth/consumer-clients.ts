import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { effectiveConsumerSessionLifetimeMs } from "./domain";
import { getConsumerClientRecord } from "./service";

export interface ConsumerClient {
  clientId: string;
  appName: string;
  productId: string;
  secretDigestHex: string;
  appOrigin: string | null;
  resourceUris: readonly string[];
  oauthScopes: readonly string[];
  sessionLifetimeMs: number;
  selfRegistrationEnabled: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getConsumerClient(clientId: string): Promise<ConsumerClient | null> {
  if (!UUID_PATTERN.test(clientId)) return null;
  const record = await getConsumerClientRecord(clientId.toLowerCase());
  if (!record || record.status !== "active") return null;
  return {
    clientId: record.consumerClientId,
    appName: record.appName,
    productId: record.productId,
    secretDigestHex: record.verifier.digestHex,
    appOrigin: record.appOrigin,
    resourceUris: record.resourceUris ?? [],
    oauthScopes: record.oauthScopes ?? [],
    sessionLifetimeMs: effectiveConsumerSessionLifetimeMs(record.sessionLifetimeMs),
    selfRegistrationEnabled: record.selfRegistrationEnabled,
  };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyConsumerClientSecret(
  client: ConsumerClient,
  providedSecret: string,
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(client.secretDigestHex)) return false;
  const expected = Buffer.from(client.secretDigestHex, "hex");
  const actual = digest(providedSecret);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function authenticateConsumerClient(request: Request): Promise<ConsumerClient | null> {
  const clientId = request.headers.get("x-perminister-client-id") ?? "";
  const providedSecret = request.headers.get("x-perminister-client-secret") ?? "";
  if (!providedSecret) return null;
  const client = await getConsumerClient(clientId);
  if (!client || !verifyConsumerClientSecret(client, providedSecret)) return null;
  return client;
}

export async function authenticateConsumerClientBasic(request: Request): Promise<ConsumerClient | null> {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0) return null;
  const decodeFormValue = (value: string) => {
    try {
      return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      return null;
    }
  };
  const clientId = decodeFormValue(decoded.slice(0, separator));
  const clientSecret = decodeFormValue(decoded.slice(separator + 1));
  if (!clientId || !clientSecret) return null;
  const client = await getConsumerClient(clientId);
  if (!client || !verifyConsumerClientSecret(client, clientSecret)) return null;
  return client;
}
