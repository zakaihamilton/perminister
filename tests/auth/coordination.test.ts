import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  consumeProductLookupRateLimit,
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
});
