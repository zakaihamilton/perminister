import { describe, expect, it } from "vitest";
import { GET } from "@/app/login/submit/route";

describe("/login/submit GET route", () => {
  it("redirects GET requests with query params back to /login via 303", async () => {
    const request = new Request("https://example.test/login/submit?__perminister_action=refresh&next=%2Fdashboard", {
      method: "GET",
    });
    const response = await GET(request);
    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBe("https://example.test/login?__perminister_action=refresh&next=%2Fdashboard");
  });
});
