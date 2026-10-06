import "server-only";

import { MailDeliveryUnavailableError } from "./service";

interface ResendConfiguration {
  apiKey: string;
  from: string;
  publicOrigin: URL;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function readResendConfiguration(): ResendConfiguration | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.PERMINISTER_MAIL_FROM?.trim();
  const publicOriginValue = process.env.PERMINISTER_PUBLIC_ORIGIN?.trim();
  if (!apiKey || !from || !publicOriginValue) return null;
  try {
    const publicOrigin = new URL(publicOriginValue);
    const allowLocalHttp = process.env.NODE_ENV !== "production";
    const isSecure =
      publicOrigin.protocol === "https:" ||
      (allowLocalHttp &&
        publicOrigin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(publicOrigin.hostname));
    if (
      !isSecure ||
      publicOrigin.username ||
      publicOrigin.password ||
      publicOrigin.search ||
      publicOrigin.hash
    ) return null;
    return { apiKey, from, publicOrigin };
  } catch {
    return null;
  }
}

export function isMailDeliveryConfigured(): boolean {
  return readResendConfiguration() !== null;
}

export function publicOrigin(): URL {
  const configuration = readResendConfiguration();
  if (!configuration) throw new MailDeliveryUnavailableError();
  return configuration.publicOrigin;
}

async function sendWithResend(message: OutboundEmail): Promise<void> {
  const configuration = readResendConfiguration();
  if (!configuration) throw new MailDeliveryUnavailableError();
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ from: configuration.from, ...message }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new Error("Resend could not be reached. No email was sent.");
  }
  if (!response.ok) {
    throw new Error(`Resend rejected the message (HTTP ${response.status}). No email was sent.`);
  }
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const origin = publicOrigin();
  const link = new URL("/verify-email", origin);
  link.searchParams.set("token", token);
  const safeLink = link.toString();
  await sendWithResend({
    to: email,
    subject: "Verify your Perminister email address",
    text: `Confirm your Perminister email address within 30 minutes: ${safeLink}`,
    html: `<p>Confirm your Perminister email address within 30 minutes:</p><p><a href="${safeLink}">Verify email</a></p>`,
  });
}

export async function sendRecoveryEmail(email: string, token: string): Promise<void> {
  const origin = publicOrigin();
  const link = new URL("/reset-password", origin);
  link.searchParams.set("token", token);
  const safeLink = link.toString();
  await sendWithResend({
    to: email,
    subject: "Reset your Perminister password",
    text: `Reset your Perminister password within 30 minutes: ${safeLink}`,
    html: `<p>Reset your Perminister password within 30 minutes:</p><p><a href="${safeLink}">Reset password</a></p>`,
  });
}
