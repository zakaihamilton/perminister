import "server-only";

import { createHmac } from "node:crypto";
import { OBJECT_PREFIX } from "./keys-and-validation";
import type { AuthObjectClient } from "./object-client";

const MAX_RATE_LIMIT_ENTRIES_PER_SHARD = 512;

export class SpacesRateLimitStore {
  private readonly rateLimitQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly s3: AuthObjectClient,
    private readonly identityIndexSecret: string,
  ) {}

  async consumeRateLimit(
    namespace: string,
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(namespace)) {
      throw new Error("Invalid rate-limit namespace");
    }
    if (
      !key ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1
    ) {
      throw new Error("Invalid rate-limit configuration");
    }

    const digest = createHmac("sha256", this.identityIndexSecret)
      .update(`${namespace}\0${key}`)
      .digest("hex");
    if (this.s3.consumeRateLimits) {
      return this.s3.consumeRateLimits([{ namespace, digest, limit, windowMs }]);
    }
    if (this.s3.consumeRateLimit) {
      return this.s3.consumeRateLimit(namespace, digest, limit, windowMs);
    }
    const shard = digest.slice(0, 2);
    const objectKey = `${OBJECT_PREFIX}security/rate-limits/${namespace}/${shard}.json`;

    return this.withRateLimitLock(objectKey, async () => {
      const now = Date.now();
      const stored = await this.s3.readJson<unknown>(objectKey);
      const entries: Record<string, { count: number; resetAt: number }> = {};
      if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
        for (const [storedDigest, value] of Object.entries(stored)) {
          if (
            /^[a-f0-9]{64}$/.test(storedDigest) &&
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            const candidate = value as { count?: unknown; resetAt?: unknown };
            if (
              Number.isSafeInteger(candidate.count) &&
              (candidate.count as number) > 0 &&
              Number.isSafeInteger(candidate.resetAt) &&
              (candidate.resetAt as number) > now
            ) {
              entries[storedDigest] = {
                count: candidate.count as number,
                resetAt: candidate.resetAt as number,
              };
            }
          }
        }
      }

      const current = entries[digest];
      if (current && current.count >= limit) return false;
      if (!current && Object.keys(entries).length >= MAX_RATE_LIMIT_ENTRIES_PER_SHARD) {
        let earliestDigest: string | undefined;
        let earliestResetAt = Number.POSITIVE_INFINITY;
        for (const [storedDigest, entry] of Object.entries(entries)) {
          if (entry.resetAt < earliestResetAt) {
            earliestDigest = storedDigest;
            earliestResetAt = entry.resetAt;
          }
        }
        if (earliestDigest) delete entries[earliestDigest];
      }

      entries[digest] = current
        ? { ...current, count: current.count + 1 }
        : { count: 1, resetAt: now + windowMs };
      await this.s3.writeJson(objectKey, entries);
      return true;
    });
  }

  private async withRateLimitLock<Result>(
    key: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.rateLimitQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.rateLimitQueues.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.rateLimitQueues.get(key) === current) this.rateLimitQueues.delete(key);
    }
  }
}
