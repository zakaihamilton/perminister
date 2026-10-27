import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());

describe("preview write isolation", () => {
  it.each(["/ui-preview", "/ui-preview/auth", "/ui-preview/request", "/actions/verifyEmailAction"])(
    "matches %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    },
  );
  it.each(["/ui-preview", "/ui-preview/auth", "/ui-preview/request", "/actions/verifyEmailAction"])(
    "rejects writes to %s in preview mode",
    async (path) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("PERMINISTER_UI_PREVIEW", "1");
      const response = await proxy(
        new NextRequest(`http://localhost:3217${path}`, { method: "POST" }),
      );
      expect(response.status).toBe(403);
    },
  );
  it("does not activate the preview guard in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PERMINISTER_UI_PREVIEW", "1");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    const response = await proxy(
      new NextRequest("https://example.test/ui-preview", { method: "POST" }),
    );
    expect(response.status).not.toBe(403);
  });
});
