import { describe, expect, it } from "vitest";
import { ProcessLocalLoginThrottle } from "../../src/lib/auth/login-throttle";

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURE_DELAY_MS = 1_000;

describe("process-local login failure delay", () => {
  it("increases delay after failures and clears it when the window expires", () => {
    let now = 1_000;
    const throttle = new ProcessLocalLoginThrottle(() => now);

    for (let attempt = 0; attempt < 9; attempt += 1) {
      const reservation = throttle.beginAttempt("person@example.com");
      expect(reservation.delayMs).toBe(Math.min(attempt * 125, MAX_FAILURE_DELAY_MS));
      reservation.recordFailure();
    }

    const delayed = throttle.beginAttempt("person@example.com");
    expect(delayed.delayMs).toBe(MAX_FAILURE_DELAY_MS);
    delayed.release();

    now += FAILURE_WINDOW_MS + 1;
    const reset = throttle.beginAttempt("person@example.com");
    expect(reset.delayMs).toBe(0);
    reset.release();
  });

  it("clears a successful sign-in and keeps process instances independent", () => {
    const firstInstance = new ProcessLocalLoginThrottle(() => 2_000);
    const secondInstance = new ProcessLocalLoginThrottle(() => 2_000);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      firstInstance.beginAttempt("person@example.com").recordFailure();
    }

    const firstDelay = firstInstance.beginAttempt("person@example.com");
    expect(firstDelay.delayMs).toBe(MAX_FAILURE_DELAY_MS);
    firstDelay.release();

    secondInstance.beginAttempt("person@example.com").recordFailure();
    const successful = secondInstance.beginAttempt("person@example.com");
    expect(successful.delayMs).toBe(125);
    successful.recordSuccess();
    const afterSuccess = secondInstance.beginAttempt("person@example.com");
    expect(afterSuccess.delayMs).toBe(0);
    afterSuccess.release();
  });

  it("counts pending attempts after they finish without locking the identifier", () => {
    const throttle = new ProcessLocalLoginThrottle(() => 3_000);
    const reservations = Array.from({ length: 8 }, (_, attempt) => {
      const reservation = throttle.beginAttempt("person@example.com");
      expect(reservation.delayMs).toBe(attempt * 125);
      return reservation;
    });
    const concurrent = throttle.beginAttempt("person@example.com");
    expect(concurrent.delayMs).toBe(MAX_FAILURE_DELAY_MS);
    concurrent.release();

    reservations.forEach((reservation) => reservation.recordFailure());
    const delayed = throttle.beginAttempt("person@example.com");
    expect(delayed.delayMs).toBe(MAX_FAILURE_DELAY_MS);
    delayed.release();
  });

  it("preserves pending reservations when a successful sign-in clears failures", () => {
    const throttle = new ProcessLocalLoginThrottle(() => 4_000);
    const failed = throttle.beginAttempt("person@example.com");
    const successful = throttle.beginAttempt("person@example.com");
    const pending = throttle.beginAttempt("person@example.com");
    failed.recordFailure();
    successful.recordSuccess();

    const remaining = Array.from({ length: 7 }, () => throttle.beginAttempt("person@example.com"));
    remaining.forEach((reservation, index) => {
      expect(reservation.delayMs).toBe((index + 1) * 125);
    });

    pending.recordFailure();
    remaining.forEach((reservation) => reservation.recordFailure());
    const delayed = throttle.beginAttempt("person@example.com");
    expect(delayed.delayMs).toBe(MAX_FAILURE_DELAY_MS);
    delayed.release();
  });

  it("releases infrastructure errors without counting them as failures", () => {
    const throttle = new ProcessLocalLoginThrottle(() => 5_000);
    const failedInfrastructureAttempt = throttle.beginAttempt("person@example.com");
    failedInfrastructureAttempt.release();
    failedInfrastructureAttempt.recordFailure();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      throttle.beginAttempt("person@example.com").recordFailure();
    }
    const delayed = throttle.beginAttempt("person@example.com");
    expect(delayed.delayMs).toBe(MAX_FAILURE_DELAY_MS);
    delayed.release();
  });

  it("keeps accepting attempts when the failure bucket limit is full", () => {
    const throttle = new ProcessLocalLoginThrottle(() => 10_000, 1);
    const active = throttle.beginAttempt("active@example.com");
    const untracked = throttle.beginAttempt("untracked@example.com");
    expect(untracked.delayMs).toBe(0);

    untracked.recordFailure();
    active.recordFailure();
    const tracked = throttle.beginAttempt("active@example.com");
    expect(tracked.delayMs).toBe(125);
    tracked.release();

    const fresh = throttle.beginAttempt("fresh@example.com");
    expect(fresh.delayMs).toBe(0);
    fresh.release();
  });
});
