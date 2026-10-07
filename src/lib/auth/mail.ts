import "server-only";

import { MailDeliveryUnavailableError } from "./service";

interface ResendConfiguration {
  apiKey: string;
  from: string;
}

interface EmailLinkOptions {
  origin?: string | null;
  appOrigin?: string | null;
  appName?: string;
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
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

function parsePublicOrigin(value: string): URL | null {
  try {
    const origin = new URL(value);
    const allowLocalHttp = process.env.NODE_ENV !== "production";
    const isSecure =
      origin.protocol === "https:" ||
      (allowLocalHttp &&
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname));
    if (
      !isSecure ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      return null;
    return origin;
  } catch {
    return null;
  }
}

function emailLinkOrigin(options: EmailLinkOptions = {}): URL {
  const requestOrigin = options.origin?.trim();
  if (requestOrigin) {
    const origin = parsePublicOrigin(requestOrigin);
    if (origin) return origin;
  }

  const appOrigin = options.appOrigin?.trim();
  if (appOrigin) {
    const origin = parsePublicOrigin(appOrigin);
    if (!origin) throw new MailDeliveryUnavailableError();
    return origin;
  }
  return publicOrigin();
}

export function browserOriginFromHeaders(requestHeaders: Headers): string {
  const value = requestHeaders.get("origin")?.trim();
  if (!value || !parsePublicOrigin(value)) {
    throw new Error("The browser origin is unavailable.");
  }
  return new URL(value).origin;
}

export function isMailDeliveryConfigured(): boolean {
  return readResendConfiguration() !== null;
}

export function publicOrigin(): URL {
  const value = process.env.PERMINISTER_PUBLIC_ORIGIN?.trim();
  const origin = value ? parsePublicOrigin(value) : null;
  if (!origin) throw new MailDeliveryUnavailableError();
  return origin;
}

async function sendWithResend(message: OutboundEmail): Promise<void> {
  const configuration = readResendConfiguration();
  if (!configuration) throw new MailDeliveryUnavailableError();
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
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

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  options: EmailLinkOptions = {},
): Promise<void> {
  const origin = emailLinkOrigin(options);
  const appName = options.appName ?? "Perminister";
  const safeAppName = escapeHtml(appName);
  const link = new URL(options.appOrigin ? "/auth/verify-email" : "/verify-email", origin);
  link.searchParams.set("token", token);
  const safeLink = link.toString();
  await sendWithResend({
    to: email,
    subject: `Verify your ${appName} account`,
    text: `Confirm your ${appName} account within 30 minutes: ${safeLink}`,
    html: `<p>Confirm your ${safeAppName} account within 30 minutes:</p><p><a href="${safeLink}">Verify email</a></p>`,
  });
}

export async function sendRecoveryEmail(
  email: string,
  token: string,
  options: EmailLinkOptions = {},
): Promise<void> {
  const origin = emailLinkOrigin(options);
  const appName = options.appName ?? "Perminister";
  const safeAppName = escapeHtml(appName);
  const link = new URL(options.appOrigin ? "/auth/reset-password" : "/reset-password", origin);
  link.searchParams.set("token", token);
  const safeLink = link.toString();
  await sendWithResend({
    to: email,
    subject: `Reset your ${appName} password`,
    text: `Reset your ${appName} password within 30 minutes: ${safeLink}`,
    html: `<p>Reset your ${safeAppName} password within 30 minutes:</p><p><a href="${safeLink}">Reset password</a></p>`,
  });
}

export async function sendOrganizationInvitationEmail(
  email: string,
  token: string,
  organizationName: string,
  role: "admin" | "member",
  options: Pick<EmailLinkOptions, "origin"> = {},
): Promise<void> {
  const origin = emailLinkOrigin(options);
  const link = new URL("/accept-invitation", origin);
  link.searchParams.set("token", token);
  const safeLink = link.toString();
  const safeName = escapeHtml(organizationName);
  await sendWithResend({
    to: email,
    subject: `Invitation to join ${organizationName} on Perminister`,
    text: `You have been invited to join ${organizationName} as an organization ${role}. Accept the invitation within 7 days: ${safeLink}`,
    html: `<p>You have been invited to join <strong>${safeName}</strong> as an organization ${role}.</p><p><a href="${safeLink}">Accept invitation</a></p><p>This invitation expires in 7 days.</p>`,
  });
}

export async function sendProductInvitationEmail(
  email: string,
  token: string,
  productName: string,
  role: "admin" | "member",
  options: Pick<EmailLinkOptions, "origin"> = {},
): Promise<void> {
  const origin = emailLinkOrigin(options);
  const link = new URL("/accept-invitation", origin);
  link.searchParams.set("token", token);
  const safeLink = link.toString();
  const safeName = escapeHtml(productName);
  const productRole = role === "admin" ? "Product Admin" : "Product Member";
  await sendWithResend({
    to: email,
    subject: `Invitation to join ${productName} on Perminister`,
    text: `You have been invited to join the ${productName} product as a ${productRole}. This invitation applies to this product only. Accept the invitation within 7 days: ${safeLink}`,
    html: `<p>You have been invited to join the <strong>${safeName}</strong> product as a ${productRole}.</p><p>This invitation applies to this product only.</p><p><a href="${safeLink}">Accept invitation</a></p><p>This invitation expires in 7 days.</p>`,
  });
}
