import { describe, expect, it } from "vitest";
import { noStoreJsonResponse } from "@/lib/auth/http";

describe("no-store JSON responses", () => {
  it("sets cache headers on JSON responses", async () => {
    const response = noStoreJsonResponse({ active: false });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(await response.json()).toEqual({ active: false });
  });

  it("adds an authentication challenge only to unauthorized responses", () => {
    const unauthorized = noStoreJsonResponse(
      { error: "invalid_client" },
      401,
      'Basic realm="Perminister OIDC token endpoint"',
    );
    const badRequest = noStoreJsonResponse({ error: "invalid_request" }, 400);

    expect(unauthorized.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="Perminister OIDC token endpoint"',
    );
    expect(badRequest.headers.has("WWW-Authenticate")).toBe(false);
  });
});
