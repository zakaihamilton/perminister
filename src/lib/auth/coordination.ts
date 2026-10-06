import "server-only";

import { randomBytes } from "node:crypto";
import { assertOpaqueId } from "./domain";

const ORGANIZATION_LOCK_TTL_MS = 10 * 60 * 1000;
const ORGANIZATION_LOCK_RENEW_MS = 2 * 60 * 1000;
const ORGANIZATION_LOCK_WAIT_MS = 30 * 1000;
const LOOKUP_WINDOW_MS = 60 * 1000;
const LOOKUP_LIMIT = 10;
const REDIS_TIMEOUT_MS = 3_000;

interface RedisRestConfiguration {
  url: URL;
  token: string;
}

interface RedisRestResponse {
  result?: unknown;
  error?: string;
}

const localLocks = new Map<string, Promise<void>>();
const localLookupWindows = new Map<string, { startedAt: number; count: number }>();

function redisConfiguration(): RedisRestConfiguration | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return { url: parsed, token };
  } catch {
    return null;
  }
}

async function redisCommand(command: readonly (string | number)[]): Promise<unknown> {
  const configuration = redisConfiguration();
  if (!configuration) throw new Error("Organization coordination is not configured.");

  let response: Response;
  try {
    response = await fetch(configuration.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Organization coordination is unavailable.");
  }
  if (!response.ok) throw new Error("Organization coordination is unavailable.");

  let result: RedisRestResponse;
  try {
    result = await response.json() as RedisRestResponse;
  } catch {
    throw new Error("Organization coordination is unavailable.");
  }
  if (result.error) throw new Error("Organization coordination is unavailable.");
  return result.result;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withLocalLock<Result>(key: string, operation: () => Promise<Result>): Promise<Result> {
  const previous = localLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  localLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localLocks.get(key) === current) localLocks.delete(key);
  }
}

async function withRedisLock<Result>(key: string, operation: () => Promise<Result>): Promise<Result> {
  const lockToken = randomBytes(32).toString("base64url");
  const deadline = Date.now() + ORGANIZATION_LOCK_WAIT_MS;
  let acquired = false;

  while (!acquired && Date.now() < deadline) {
    acquired = await redisCommand(["SET", key, lockToken, "NX", "PX", ORGANIZATION_LOCK_TTL_MS]) === "OK";
    if (!acquired) await delay(30 + Math.floor(Math.random() * 70));
  }
  if (!acquired) throw new Error("Organization is busy. Try again shortly.");

  let leaseLost = false;
  let renewal: Promise<void> | undefined;
  const renew = async () => {
    try {
      const result = await redisCommand([
        "EVAL",
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        key,
        lockToken,
        ORGANIZATION_LOCK_TTL_MS,
      ]);
      if (result !== 1) leaseLost = true;
    } catch {
      leaseLost = true;
    }
  };
  const timer = setInterval(() => {
    if (!renewal) renewal = renew().finally(() => { renewal = undefined; });
  }, ORGANIZATION_LOCK_RENEW_MS);
  timer.unref?.();

  try {
    const result = await operation();
    if (leaseLost) throw new Error("Organization coordination was interrupted. Retry the action.");
    return result;
  } finally {
    clearInterval(timer);
    if (renewal) await renewal;
    if (!leaseLost) {
      try {
        await redisCommand([
          "EVAL",
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          lockToken,
        ]);
      } catch {
        // The lease expires on its own if release cannot reach Redis.
      }
    }
  }
}

export async function withOrganizationMutationLock<Result>(
  organizationId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  assertOpaqueId(organizationId);
  const key = `perminister:organization-lock:${organizationId}`;
  if (!redisConfiguration()) {
    if (process.env.NODE_ENV === "production") throw new Error("Organization coordination is not configured.");
    return withLocalLock(key, operation);
  }
  return withRedisLock(key, operation);
}

export async function consumeProductLookupRateLimit(
  organizationId: string,
  subjectId: string,
): Promise<boolean> {
  assertOpaqueId(organizationId);
  assertOpaqueId(subjectId);
  const now = Date.now();
  const window = Math.floor(now / LOOKUP_WINDOW_MS);
  const key = `perminister:product-lookup:${organizationId}:${subjectId}:${window}`;
  if (!redisConfiguration()) {
    if (process.env.NODE_ENV === "production") throw new Error("Organization coordination is not configured.");
    const current = localLookupWindows.get(key);
    if (!current || now - current.startedAt >= LOOKUP_WINDOW_MS) {
      localLookupWindows.set(key, { startedAt: now, count: 1 });
    } else if (current.count >= LOOKUP_LIMIT) {
      return false;
    } else {
      current.count += 1;
    }
    if (localLookupWindows.size > 500) {
      for (const [oldKey, value] of localLookupWindows) {
        if (now - value.startedAt >= LOOKUP_WINDOW_MS) localLookupWindows.delete(oldKey);
      }
    }
    return true;
  }

  const count = await redisCommand([
    "EVAL",
    "local count = redis.call('incr', KEYS[1]); if count == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end; return count",
    1,
    key,
    LOOKUP_WINDOW_MS,
  ]);
  return typeof count === "number" && count <= LOOKUP_LIMIT;
}
