import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  consumePasswordRecoveryRateLimit,
  consumeProductLookupRateLimit,
  passwordRecoveryRequesterKey,
  withOrganizationMutationLock,
} from "../../src/lib/auth/coordination";

vi.mock("server-only", () => ({}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "33333333-3333-4333-8333-333333333333";

describe("process-local mutation coordination", () => {
  it("serializes mutations for one organization inside the process", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withOrganizationMutationLock(ORGANIZATION_ID, async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
    });
    const second = withOrganizationMutationLock(ORGANIZATION_ID, async () => {
      order.push("second-start");
    });

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("enforces ten lookups per minute for an organization member", async () => {
    const results = await Promise.all(
      Array.from({ length: 11 }, () => consumeProductLookupRateLimit(ORGANIZATION_ID, SUBJECT_ID)),
    );

    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.at(-1)).toBe(false);
  });

  it("extracts trusted proxy client IPs and resists spoofed x-forwarded-for prefixes", () => {
    expect(
      passwordRecoveryRequesterKey(
        new Headers({
          "x-perminister-client-ip": "203.0.113.10",
          "x-forwarded-for": "198.51.100.1, 203.0.113.10",
        }),
      ),
    ).toBe("ip:203.0.113.10");

    expect(
      passwordRecoveryRequesterKey(
        new Headers({
          "x-forwarded-for": "198.51.100.1, 203.0.113.99",
        }),
      ),
    ).toBe("ip:203.0.113.99");
  });

  it("enforces per-email recovery limits and evicts single-hit email buckets under flood", () => {
    expect(consumePasswordRecoveryRateLimit("victim@example.com", "ip:203.0.113.1")).toBe(true);
    expect(consumePasswordRecoveryRateLimit("victim@example.com", "ip:203.0.113.1")).toBe(true);
    expect(consumePasswordRecoveryRateLimit("victim@example.com", "ip:203.0.113.1")).toBe(true);
    expect(consumePasswordRecoveryRateLimit("victim@example.com", "ip:203.0.113.2")).toBe(false);
  });
});
