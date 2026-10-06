import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ check: vi.fn() }));

describe("GET /api/ready", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.check.mockReset();
    vi.doMock("@/lib/auth/service", () => ({
      checkAuthStorageReadiness: mocks.check,
    }));
  });

  it("reports ready after a successful Spaces request", async () => {
    mocks.check.mockResolvedValue(undefined);
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ service: "perminister", status: "ready" });
  });

  it("returns 503 when the required Spaces request fails", async () => {
    mocks.check.mockImplementation(() => {
      throw new Error("Spaces is unavailable");
    });
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ service: "perminister", status: "not-ready" });
  });
});
