import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { getConsumerClientRecord } from "./service";

export interface ConsumerClient {
  clientId: string;
  appName: string;
  productId: string;
  secretDigestHex: string;
  appOrigin: string | null;
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
    sessionLifetimeMs: record.sessionLifetimeMs,
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
