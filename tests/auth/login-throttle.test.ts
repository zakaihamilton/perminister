import { describe, expect, it } from "vitest";
import { ProcessLocalLoginThrottle } from "../../src/lib/auth/login-throttle";

const LOCK_MS = 15 * 60 * 1000;

describe("process-local login throttling", () => {
  it("locks after eight failures and clears after the lock expires", () => {
    let now = 1_000;
    const throttle = new ProcessLocalLoginThrottle(() => now);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      throttle.beginAttempt("person@example.com").recordFailure();
    }
    expect(() => throttle.beginAttempt("person@example.com")).toThrow(/Too many sign-in attempts/);

    now += LOCK_MS + 1;
    throttle.beginAttempt("person@example.com").release();
  });

  it("clears a successful sign-in and keeps separate process instances independent", () => {
    const firstInstance = new ProcessLocalLoginThrottle(() => 2_000);
    const secondInstance = new ProcessLocalLoginThrottle(() => 2_000);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      firstInstance.beginAttempt("person@example.com").recordFailure();
    }

    expect(() => firstInstance.beginAttempt("person@example.com")).toThrow(
      /Too many sign-in attempts/,
    );
    secondInstance.beginAttempt("person@example.com").recordFailure();
    secondInstance.beginAttempt("person@example.com").recordSuccess();
    secondInstance.beginAttempt("person@example.com").release();
  });

  it("counts pending attempts against the eight-attempt capacity", () => {
    const throttle = new ProcessLocalLoginThrottle(() => 3_000);
    const reservations = Array.from({ length: 8 }, () =>
      throttle.beginAttempt("person@example.com"),
    );

    expect(() => throttle.beginAttempt("person@example.com")).toThrow(/Too many sign-in attempts/);
    reservations.forEach((reservation) => reservation.recordFailure());
    expect(() => throttle.beginAttempt("person@example.com")).toThrow(/Too many sign-in attempts/);
  });

  it("preserves other pending reservations when a successful sign-in clears failures", () => {
    const throttle = new ProcessLocalLoginThrottle(() => 4_000);
    const failed = throttle.beginAttempt("person@example.com");
    const successful = throttle.beginAttempt("person@example.com");
    const pending = throttle.beginAttempt("person@example.com");
    failed.recordFailure();
    successful.recordSuccess();

    const remaining = Array.from({ length: 7 }, () => throttle.beginAttempt("person@example.com"));
    expect(() => throttle.beginAttempt("person@example.com")).toThrow(/Too many sign-in attempts/);

    pending.recordFailure();
    remaining.forEach((reservation) => reservation.recordFailure());
    expect(() => throttle.beginAttempt("person@example.com")).toThrow(/Too many sign-in attempts/);
  });

  it("releases reservations after infrastructure errors without counting failures", () => {
    const throttle = new ProcessLocalLoginThrottle(() => 5_000);
    const failedInfrastructureAttempt = throttle.beginAttempt("person@example.com");
    failedInfrastructureAttempt.release();
    failedInfrastructureAttempt.recordFailure();

    for (let attempt = 0; attempt < 7; attempt += 1) {
      throttle.beginAttempt("person@example.com").recordFailure();
    }
    const eighthAttempt = throttle.beginAttempt("person@example.com");
    eighthAttempt.recordFailure();
    expect(() => throttle.beginAttempt("person@example.com")).toThrow(/Too many sign-in attempts/);
  });
});
