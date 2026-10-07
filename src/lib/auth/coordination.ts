import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { assertOpaqueId } from "./domain";

const LOOKUP_WINDOW_MS = 60 * 1000;
const LOOKUP_LIMIT = 10;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const RECOVERY_EMAIL_LIMIT = 3;
const RECOVERY_REQUESTER_LIMIT = 30;
const MAX_RECOVERY_BUCKETS = 10_000;

const localLocks = new Map<string, Promise<void>>();
const localLookupWindows = new Map<string, { startedAt: number; count: number }>();
const localRecoveryWindows = new Map<string, { timestamps: number[] }>();

async function withLocalLock<Result>(
  key: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previous = localLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  localLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localLocks.get(key) === current) localLocks.delete(key);
  }
}

/** Serializes organization operations in this process only. */
export function withOrganizationMutationLock<Result>(
  organizationId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  assertOpaqueId(organizationId);
  return withLocalLock(`perminister:organization-lock:${organizationId}`, operation);
}

/** Limits product lookups per organization, member, and app process. */
export async function consumeProductLookupRateLimit(
  organizationId: string,
  subjectId: string,
): Promise<boolean> {
  assertOpaqueId(organizationId);
  assertOpaqueId(subjectId);
  const now = Date.now();
  const window = Math.floor(now / LOOKUP_WINDOW_MS);
  const key = `perminister:product-lookup:${organizationId}:${subjectId}:${window}`;
  const current = localLookupWindows.get(key);
  if (!current || now - current.startedAt >= LOOKUP_WINDOW_MS) {
    localLookupWindows.set(key, { startedAt: now, count: 1 });
  } else if (current.count >= LOOKUP_LIMIT) {
    return false;
  } else {
    current.count += 1;
  }

  if (localLookupWindows.size > 500) {
    for (const [windowKey, value] of localLookupWindows) {
      if (now - value.startedAt >= LOOKUP_WINDOW_MS) localLookupWindows.delete(windowKey);
    }
  }
  return true;
}

/**
 * Returns a best-effort caller key from the proxy headers commonly set by app hosts.
 * The email limit below still applies when a deployment does not provide a client IP.
 */
export function passwordRecoveryRequesterKey(requestHeaders: Headers): string | null {
  for (const name of ["cf-connecting-ip", "x-real-ip"]) {
    const address = requestHeaders.get(name)?.trim();
    if (address && isIP(address)) return `ip:${address}`;
  }

  const forwarded = requestHeaders.get("x-forwarded-for");
  if (forwarded) {
    const address = forwarded
      .split(",")
      .map((part) => part.trim())
      .find((part) => isIP(part));
    if (address) return `ip:${address}`;
  }
  return null;
}

function recoveryBucketKey(namespace: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return `perminister:password-recovery:${namespace}:${digest}`;
}

/**
 * Limits recovery requests by address and, when available, by caller. This is process-local;
 * deployments using the Spaces store must run a single writer process.
 */
export function consumePasswordRecoveryRateLimit(
  email: string,
  requesterKey?: string | null,
  requesterLimit = RECOVERY_REQUESTER_LIMIT,
): boolean {
  const now = Date.now();
  const keys = [recoveryBucketKey("email", email.trim().toLowerCase())];
  if (requesterKey?.trim()) keys.push(recoveryBucketKey("requester", requesterKey.trim()));

  const activeAttempts = keys.map((key) =>
    (localRecoveryWindows.get(key)?.timestamps ?? []).filter(
      (timestamp) => now - timestamp < RECOVERY_WINDOW_MS,
    ),
  );
  if (
    activeAttempts.some(
      (timestamps, index) =>
        timestamps.length >= (index === 0 ? RECOVERY_EMAIL_LIMIT : requesterLimit),
    )
  ) {
    return false;
  }

  const missingKeys = keys.filter((key) => !localRecoveryWindows.has(key));
  if (localRecoveryWindows.size + missingKeys.length > MAX_RECOVERY_BUCKETS) {
    for (const [key, bucket] of localRecoveryWindows) {
      if (bucket.timestamps.every((timestamp) => now - timestamp >= RECOVERY_WINDOW_MS)) {
        localRecoveryWindows.delete(key);
      }
    }
    if (
      localRecoveryWindows.size + keys.filter((key) => !localRecoveryWindows.has(key)).length >
      MAX_RECOVERY_BUCKETS
    ) {
      return false;
    }
  }

  keys.forEach((key, index) => {
    localRecoveryWindows.set(key, { timestamps: [...activeAttempts[index], now] });
  });
  return true;
}
