import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export interface ConsumerClient {
  clientId: string;
  appName: string;
  productId: string;
  secret: string;
  appOrigin: string | null;
  sessionLifetimeMs: number;
  selfRegistrationEnabled: boolean;
}

const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function secretEnvironmentSuffix(clientId: string): string | null {
  if (!CLIENT_ID_PATTERN.test(clientId)) return null;
  return clientId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

export function getConsumerClient(clientId: string): ConsumerClient | null {
  const suffix = secretEnvironmentSuffix(clientId);
  if (!suffix) return null;
  const configuredIds = (process.env.PERMINISTER_APP_CLIENT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const canonicalClientId = configuredIds.find(
    (configuredId) => configuredId.toLowerCase() === clientId.toLowerCase(),
  );
  if (!canonicalClientId) return null;
  const canonicalSuffix = secretEnvironmentSuffix(canonicalClientId);
  if (!canonicalSuffix) return null;
  const configuredName = process.env[`PERMINISTER_APP_CLIENT_${canonicalSuffix}_NAME`]?.trim();
  const appName = configuredName || canonicalClientId;
  if (appName.length > 80 || /[\u0000-\u001f\u007f]/.test(appName)) return null;
  const secret = process.env[`PERMINISTER_APP_CLIENT_${canonicalSuffix}_SECRET`]?.trim();
  if (!secret || secret.length < 32) return null;
  const productId = (
    process.env[`PERMINISTER_APP_CLIENT_${canonicalSuffix}_PRODUCT_ID`]?.trim() || canonicalClientId
  ).toLowerCase();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(productId)) return null;
  const configuredOrigin = process.env[`PERMINISTER_APP_CLIENT_${canonicalSuffix}_ORIGIN`]?.trim();
  let appOrigin: string | null = null;
  if (configuredOrigin) {
    try {
      const parsed = new URL(configuredOrigin);
      const isSecure =
        parsed.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" &&
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname));
      if (
        !isSecure ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        return null;
      }
      appOrigin = parsed.origin;
    } catch {
      return null;
    }
  }
  const normalizedClientId = canonicalClientId.toLowerCase();
  const defaultSessionLifetimeSeconds =
    normalizedClientId === "visitoring"
      ? 30 * 24 * 60 * 60
      : normalizedClientId === "postparticle"
        ? 8 * 60 * 60
        : 12 * 60 * 60;
  const configuredSessionLifetime =
    process.env[`PERMINISTER_APP_CLIENT_${canonicalSuffix}_SESSION_LIFETIME_SECONDS`]?.trim();
  const sessionLifetimeSeconds = configuredSessionLifetime
    ? Number(configuredSessionLifetime)
    : defaultSessionLifetimeSeconds;
  if (
    !Number.isSafeInteger(sessionLifetimeSeconds) ||
    sessionLifetimeSeconds < 5 * 60 ||
    sessionLifetimeSeconds > 90 * 24 * 60 * 60
  ) {
    return null;
  }
  const configuredRegistration = process.env[
    `PERMINISTER_APP_CLIENT_${canonicalSuffix}_SELF_REGISTRATION_ENABLED`
  ]
    ?.trim()
    .toLowerCase();
  const firstPartyClient = ["visitoring", "postparticle"].includes(normalizedClientId);
  if (configuredRegistration && !["true", "false"].includes(configuredRegistration)) return null;
  const selfRegistrationEnabled = firstPartyClient
    ? false
    : configuredRegistration
      ? configuredRegistration === "true"
      : true;
  return {
    clientId: canonicalClientId,
    appName,
    productId,
    secret,
    appOrigin,
    sessionLifetimeMs: sessionLifetimeSeconds * 1000,
    selfRegistrationEnabled,
  };
}

export function getConsumerClientsForProduct(productId: string): ConsumerClient[] {
  const normalizedProductId = productId.trim().toLowerCase();
  if (!normalizedProductId) return [];
  const configuredIds = (process.env.PERMINISTER_APP_CLIENT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const clients: ConsumerClient[] = [];
  for (const clientId of configuredIds) {
    const client = getConsumerClient(clientId);
    if (
      client &&
      client.productId === normalizedProductId &&
      !seen.has(client.clientId.toLowerCase())
    ) {
      seen.add(client.clientId.toLowerCase());
      clients.push(client);
    }
  }
  return clients;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyConsumerClientSecret(
  client: ConsumerClient,
  providedSecret: string,
): boolean {
  return timingSafeEqual(digest(client.secret), digest(providedSecret));
}

export function authenticateConsumerClient(request: Request): ConsumerClient | null {
  const clientId = request.headers.get("x-perminister-client-id") ?? "";
  const providedSecret = request.headers.get("x-perminister-client-secret") ?? "";
  const client = getConsumerClient(clientId);
  if (!client || !providedSecret || !verifyConsumerClientSecret(client, providedSecret))
    return null;
  return client;
}
