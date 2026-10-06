import { createHash } from "node:crypto";

const MAX_LOGIN_FAILURES = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

interface FailureRecord {
  count: number;
  resetAt: number;
  lockedUntil: number;
  inFlight: number;
}

export interface LoginAttemptReservation {
  recordFailure(): void;
  recordSuccess(): void;
  release(): void;
}

function throttleKey(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

/** In-memory login throttling. Limits are local to the current app process. */
export class ProcessLocalLoginThrottle {
  private readonly failures = new Map<string, FailureRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  beginAttempt(email: string): LoginAttemptReservation {
    const key = throttleKey(email);
    const now = this.now();
    const record = this.failures.get(key) ?? {
      count: 0,
      resetAt: 0,
      lockedUntil: 0,
      inFlight: 0,
    };
    if (record.lockedUntil > now) throw new Error("Too many sign-in attempts. Try again later.");
    if (record.resetAt > 0 && record.resetAt <= now) {
      record.count = 0;
      record.resetAt = 0;
      record.lockedUntil = 0;
    }
    if (record.count + record.inFlight >= MAX_LOGIN_FAILURES) {
      this.failures.set(key, record);
      throw new Error("Too many sign-in attempts. Try again later.");
    }

    record.inFlight += 1;
    this.failures.set(key, record);
    this.pruneExpired(now);

    let finalized = false;
    const finish = (outcome: "failure" | "success" | "released") => {
      if (finalized) return;
      finalized = true;

      const current = this.failures.get(key);
      if (!current) return;
      const completedAt = this.now();
      current.inFlight = Math.max(0, current.inFlight - 1);

      if (outcome === "success") {
        current.count = 0;
        current.resetAt = 0;
        current.lockedUntil = 0;
      } else if (outcome === "failure") {
        if (current.resetAt === 0 || current.resetAt <= completedAt) {
          current.count = 0;
          current.resetAt = completedAt + LOGIN_WINDOW_MS;
          current.lockedUntil = 0;
        }
        current.count += 1;
        if (current.count >= MAX_LOGIN_FAILURES) {
          current.lockedUntil = completedAt + LOGIN_LOCK_MS;
        }
      }

      if (current.count === 0 && current.inFlight === 0) {
        this.failures.delete(key);
      } else {
        this.failures.set(key, current);
      }
      this.pruneExpired(completedAt);
    };

    return {
      recordFailure: () => finish("failure"),
      recordSuccess: () => finish("success"),
      release: () => finish("released"),
    };
  }

  private pruneExpired(now: number): void {
    if (this.failures.size <= 5000) return;
    for (const [key, record] of this.failures) {
      if (record.inFlight === 0 && record.resetAt <= now && record.lockedUntil <= now) {
        this.failures.delete(key);
      }
    }
  }
}

export const processLocalLoginThrottle = new ProcessLocalLoginThrottle();
