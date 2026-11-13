import { createHash } from "node:crypto";

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_DELAY_STEP_MS = 125;
const MAX_FAILURE_DELAY_MS = 1_000;
const MAX_THROTTLE_BUCKETS = 10_000;

interface FailureRecord {
  count: number;
  resetAt: number;
  inFlight: number;
}

export interface LoginAttemptReservation {
  delayMs: number;
  recordFailure(): void;
  recordSuccess(): void;
  release(): void;
}

function throttleKey(identifier: string): string {
  return createHash("sha256").update(identifier).digest("hex");
}

/** Adds a small, process-local delay after failures without locking an account. */
export class ProcessLocalLoginThrottle {
  private readonly failures = new Map<string, FailureRecord>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxBuckets: number = MAX_THROTTLE_BUCKETS,
  ) {}

  beginAttempt(identifier: string): LoginAttemptReservation {
    const key = throttleKey(identifier);
    const now = this.now();
    let record = this.failures.get(key);
    if (record && record.resetAt > 0 && record.resetAt <= now) {
      record.count = 0;
      record.resetAt = 0;
      if (record.inFlight === 0) {
        this.failures.delete(key);
        record = undefined;
      }
    }

    let tracked = true;
    if (!record && this.failures.size >= this.maxBuckets) {
      const removableKey = [...this.failures].find(([, candidate]) => candidate.inFlight === 0)?.[0];
      if (removableKey !== undefined) this.failures.delete(removableKey);
      else tracked = false;
    }

    if (!record && tracked) {
      record = { count: 0, resetAt: 0, inFlight: 0 };
    }
    const delayMs = record
      ? Math.min(MAX_FAILURE_DELAY_MS, (record.count + record.inFlight) * FAILURE_DELAY_STEP_MS)
      : 0;

    if (record) {
      record.inFlight += 1;
      this.failures.delete(key);
      this.failures.set(key, record);
    }

    let finalized = false;
    const finish = (outcome: "failure" | "success" | "released") => {
      if (finalized) return;
      finalized = true;
      if (!tracked) return;

      const current = this.failures.get(key);
      if (!current) return;
      const completedAt = this.now();
      current.inFlight = Math.max(0, current.inFlight - 1);

      if (outcome === "success") {
        current.count = 0;
        current.resetAt = 0;
      } else if (outcome === "failure") {
        if (current.resetAt === 0 || current.resetAt <= completedAt) {
          current.count = 0;
          current.resetAt = completedAt + FAILURE_WINDOW_MS;
        }
        current.count += 1;
      }

      if (current.count === 0 && current.inFlight === 0) {
        this.failures.delete(key);
      } else {
        this.failures.delete(key);
        this.failures.set(key, current);
      }
    };

    return {
      delayMs,
      recordFailure: () => finish("failure"),
      recordSuccess: () => finish("success"),
      release: () => finish("released"),
    };
  }
}

export const processLocalLoginThrottle = new ProcessLocalLoginThrottle();
