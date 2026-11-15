import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  consumeLoginRequestRateLimit: vi.fn(),
  createSession: vi.fn(),
  setSessionCookie: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/coordination", () => ({
  passwordRecoveryRequesterKey: () => null,
}));
vi.mock("@/lib/auth/service", () => mocks);

import { handleLoginPost } from "@/lib/auth/login-session-handler";

function loginRequest(next: string) {
  const body = new URLSearchParams({
    email: "alex@example.test",
    password: "correct-password",
    next,
  });
  return new Request("https://www.perminister.com/login/submit", {
    method: "POST",
    headers: {
      host: "www.perminister.com",
      origin: "https://www.perminister.com",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

describe("successful Perminister login return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ subjectId: "subject-id" });
    mocks.createSession.mockResolvedValue({ token: "session-token" });
    mocks.setSessionCookie.mockResolvedValue(undefined);
  });

  it("clears the satisfied prompt=login before returning to product authorization", async () => {
    const next = `/oauth/authorize?${new URLSearchParams({
      client_id: "client-id",
      prompt: "login",
      error: "unavailable",
      state: "opaque-state",
    })}`;
    const response = await handleLoginPost(loginRequest(next));

    expect(response.status).toBe(303);
    const destination = new URL(response.headers.get("location") ?? "");
    expect(destination.origin).toBe("https://www.perminister.com");
    expect(destination.pathname).toBe("/oauth/authorize");
    expect(destination.searchParams.get("client_id")).toBe("client-id");
    expect(destination.searchParams.get("state")).toBe("opaque-state");
    expect(destination.searchParams.has("prompt")).toBe(false);
    expect(destination.searchParams.has("error")).toBe(false);
  });
});
