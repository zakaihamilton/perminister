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
  const appOrigin = options.appOrigin?.trim();
  if (appOrigin) {
    const origin = parsePublicOrigin(appOrigin);
    if (!origin) throw new MailDeliveryUnavailableError();
    return origin;
  }

  const requestOrigin = options.origin?.trim();
  if (requestOrigin) {
    const origin = parsePublicOrigin(requestOrigin);
    if (origin) return origin;
  }

  return publicOrigin();
}

export function browserOriginFromHeaders(requestHeaders: Headers): string {
  // Production email links must use the configured canonical domain, even if
  // an admin opened the app through a Vercel deployment alias.
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.VERCEL !== "1" || process.env.VERCEL_ENV === "production")
  ) {
    return publicOrigin().origin;
  }

  const value = requestHeaders.get("origin")?.trim();
  const requestOrigin = value ? parsePublicOrigin(value) : null;
  return (requestOrigin ?? publicOrigin()).origin;
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

type AccountEmailAction = "verification" | "recovery";

async function sendAccountActionEmail(
  action: AccountEmailAction,
  email: string,
  token: string,
  options: EmailLinkOptions,
): Promise<void> {
  const isVerification = action === "verification";
  // Recovery tokens grant global account access and must never be sent to a client origin.
  if (!isVerification) options = {};
  const origin = isVerification ? emailLinkOrigin(options) : publicOrigin();
  const appName = options.appName ?? "Perminister";
  const link = new URL(
    options.appOrigin
      ? isVerification
        ? "/auth/verify-email"
        : "/auth/reset-password"
      : isVerification
        ? "/verify-email"
        : "/reset-password",
    origin,
  );
  link.searchParams.set("token", token);
  const safeLink = link.toString();
  const message = isVerification
    ? `Confirm your ${appName} account`
    : `Reset your ${appName} password`;
  await sendWithResend({
    to: email,
    subject: isVerification ? `Verify your ${appName} account` : `Reset your ${appName} password`,
    text: `${message} within 30 minutes: ${safeLink}`,
    html: `<p>${escapeHtml(message)} within 30 minutes:</p><p><a href="${escapeHtml(safeLink)}">${isVerification ? "Verify email" : "Reset password"}</a></p>`,
  });
}

function accountActionEmailSender(action: AccountEmailAction) {
  return (email: string, token: string, options: EmailLinkOptions = {}) =>
    sendAccountActionEmail(action, email, token, options);
}

export const sendVerificationEmail = accountActionEmailSender("verification");
export const sendRecoveryEmail = accountActionEmailSender("recovery");

type InvitationKind = "organization" | "product";
type InvitationEmailOptions = Pick<EmailLinkOptions, "origin">;

function invitationEmailSender(kind: InvitationKind) {
  return async (
    email: string,
    token: string,
    resourceName: string,
    role: "admin" | "member",
    options: InvitationEmailOptions = {},
  ): Promise<void> => {
    const origin = emailLinkOrigin(options);
    const link = new URL("/accept-invitation", origin);
    link.searchParams.set("token", token);
    const url = link.toString();
    const safeLink = escapeHtml(url);
    const safeName = escapeHtml(resourceName);
    const roleLabel =
      kind === "organization"
        ? `an organization ${role}`
        : `a Product ${role === "admin" ? "Admin" : "Member"}`;
    const description =
      kind === "organization"
        ? `You have been invited to join <strong>${safeName}</strong> as ${roleLabel}.`
        : `You have been invited to join the <strong>${safeName}</strong> product as ${roleLabel}.`;
    const textDescription =
      kind === "organization"
        ? `You have been invited to join ${resourceName} as ${roleLabel}.`
        : `You have been invited to join the ${resourceName} product as ${roleLabel}. This invitation applies to this product only.`;
    const scopeNote =
      kind === "product" ? "<p>This invitation applies to this product only.</p>" : "";

    await sendWithResend({
      to: email,
      subject: `Invitation to join ${resourceName} on Perminister`,
      text: `${textDescription} Accept the invitation within 7 days: ${url}`,
      html: `<p>${description}</p>${scopeNote}<p><a href="${safeLink}">Accept invitation</a></p><p>This invitation expires in 7 days.</p>`,
    });
  };
}

export const sendOrganizationInvitationEmail = invitationEmailSender("organization");
export const sendProductInvitationEmail = invitationEmailSender("product");
