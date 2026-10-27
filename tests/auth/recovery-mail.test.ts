import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRecoveryEmail } from "@/lib/auth/mail";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("recovery email", () => {
  it("always sends the global reset token to the configured identity origin", async () => {
    vi.stubEnv("PERMINISTER_PUBLIC_ORIGIN", "https://identity.example");
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("PERMINISTER_MAIL_FROM", "auth@example.com");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendRecoveryEmail("victim@example.com", "reset-token", {
      origin: "https://attacker.example",
      appOrigin: "https://attacker.example",
      appName: "Attacker",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain("https://identity.example/reset-password?token=reset-token");
    expect(body.text).not.toContain("attacker.example");
    expect(body.subject).toContain("Perminister");
  });
});
