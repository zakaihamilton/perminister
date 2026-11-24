import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRecoveryEmail } from "@/lib/auth/mail";

const smtpMocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: smtpMocks.createTransport },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

  it("sends through the configured internal SMTP server with STARTTLS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PERMINISTER_PUBLIC_ORIGIN", "https://identity.example");
    vi.stubEnv("PERMINISTER_MAIL_PROVIDER", "smtp");
    vi.stubEnv("PERMINISTER_SMTP_URL", "smtp://mail-user:p%40ss@mail.internal.example:587");
    vi.stubEnv("PERMINISTER_SMTP_REQUIRE_TLS", "true");
    vi.stubEnv("PERMINISTER_MAIL_FROM", "Perminister <auth@example.com>");
    smtpMocks.createTransport.mockReturnValue({
      sendMail: smtpMocks.sendMail.mockResolvedValue({}),
      close: smtpMocks.close,
    });

    await sendRecoveryEmail("person@example.com", "recovery-token");

    expect(smtpMocks.createTransport).toHaveBeenCalledWith({
      host: "mail.internal.example",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "mail-user", pass: "p@ss" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    expect(smtpMocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "person@example.com",
        from: "Perminister <auth@example.com>",
        text: expect.stringContaining("https://identity.example/reset-password?token=recovery-token"),
      }),
    );
    expect(smtpMocks.close).toHaveBeenCalledOnce();
  });
});
