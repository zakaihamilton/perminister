import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ check: vi.fn() }));

describe("GET /api/ready", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.check.mockReset();
    vi.doMock("@/lib/auth/service", () => ({
      checkAuthStorageReadiness: mocks.check,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports ready after a successful Spaces request", async () => {
    mocks.check.mockResolvedValue(undefined);
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET(new Request("https://perminister.example/api/ready"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ service: "perminister", status: "ready" });
  });

  it("returns 503 when the required Spaces request fails", async () => {
    mocks.check.mockImplementation(() => {
      throw new Error("Spaces is unavailable");
    });
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET(new Request("https://perminister.example/api/ready"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ service: "perminister", status: "not-ready" });
  });

  it("reports whether the configured writer accepts the supplied proxy secret", async () => {
    vi.stubEnv("PERMINISTER_WRITE_PROXY_SECRET", "s".repeat(32));
    mocks.check.mockResolvedValue(undefined);
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET(
      new Request("https://writer.example/api/ready", {
        headers: { "x-perminister-write-proxy-secret": "s".repeat(32) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "perminister",
      status: "ready",
      proxySecretAccepted: true,
    });
  });

  it("reports a rejected supplied proxy secret without failing Railway liveness", async () => {
    vi.stubEnv("PERMINISTER_WRITE_PROXY_SECRET", "s".repeat(32));
    mocks.check.mockResolvedValue(undefined);
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET(
      new Request("https://writer.example/api/ready", {
        headers: { "x-perminister-write-proxy-secret": "x".repeat(32) },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      proxySecretAccepted: false,
    });
  });

  it("rejects Vercel readiness when the Railway proxy secret does not match", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "release-1");
    vi.stubEnv("PERMINISTER_WRITE_PROXY_URL", "https://writer.example");
    vi.stubEnv("PERMINISTER_WRITE_PROXY_SECRET", "v".repeat(32));
    mocks.check.mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        service: "perminister",
        status: "ready",
        deploymentId: "release-1",
        proxySecretAccepted: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET(new Request("https://www.perminister.com/api/ready"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "not-ready" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "x-perminister-write-proxy-secret": "v".repeat(32) },
    });
  });

  it("reports Vercel ready when Railway accepts the configured proxy secret", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "release-1");
    vi.stubEnv("PERMINISTER_WRITE_PROXY_URL", "https://writer.example");
    vi.stubEnv("PERMINISTER_WRITE_PROXY_SECRET", "v".repeat(32));
    mocks.check.mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        service: "perminister",
        status: "ready",
        deploymentId: "release-1",
        proxySecretAccepted: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET(new Request("https://www.perminister.com/api/ready"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      deploymentId: "release-1",
      writerDeploymentId: "release-1",
    });
  });

  it("reports Vercel not-ready when its write proxy secret is missing", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "release-1");
    vi.stubEnv("PERMINISTER_WRITE_PROXY_URL", "https://writer.example");
    vi.stubEnv("PERMINISTER_WRITE_PROXY_SECRET", "");
    mocks.check.mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("../../src/app/api/ready/route");

    const response = await GET(new Request("https://www.perminister.com/api/ready"));

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
