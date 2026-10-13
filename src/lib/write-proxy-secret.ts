import { timingSafeEqual } from "node:crypto";

export const WRITE_PROXY_SECRET_HEADER = "x-perminister-write-proxy-secret";

export function getConfiguredWriteProxySecret(): string | null {
  const secret = process.env.PERMINISTER_WRITE_PROXY_SECRET;
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
}

export function matchesWriteProxySecret(received: string | null, expected: string | null): boolean {
  if (!received || !expected) return false;
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
}
