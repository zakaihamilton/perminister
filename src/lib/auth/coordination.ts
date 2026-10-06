import "server-only";

import { assertOpaqueId } from "./domain";

const LOOKUP_WINDOW_MS = 60 * 1000;
const LOOKUP_LIMIT = 10;

const localLocks = new Map<string, Promise<void>>();
const localLookupWindows = new Map<string, { startedAt: number; count: number }>();

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
