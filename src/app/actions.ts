"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  authenticate,
  completeEmailAction,
  createApiKeyForSubject,
  createPermissionGrant,
  createSession,
  getCurrentSession,
  isAdministrator,
  issueEmailAction,
  issueRecoveryAction,
  registerAccount,
  revokeApiKeyForSubject,
  revokeSession,
  setSessionCookie,
  signOutCurrentSession,
  updateAccountStatus,
  updateGrantStatus,
} from "@/lib/auth/service";
import type { ResourceScope } from "@/lib/auth/domain";
import {
  isMailDeliveryConfigured,
  sendRecoveryEmail,
  sendVerificationEmail,
} from "@/lib/auth/mail";

function publicActionError(error: unknown): string {
  if (!(error instanceof Error)) return "Perminister could not complete that request.";
  const safePrefixes = [
    "An account with this email address already exists.",
    "Email or password is incorrect.",
    "Too many sign-in attempts.",
    "Use a password",
    "Password must be",
    "Enter a valid email address.",
    "Enter a valid product ID.",
    "Enter a valid project ID.",
    "Enter a valid workspace ID.",
    "Enter 1 to 32 valid action names.",
    "Choose a future expiration time.",
    "Choose an active account.",
    "Choose an active, email-verified account.",
    "An active, email-verified account is required to create an API key.",
    "Only an active, unexpired API key can be rotated.",
    "Choose one of your own API keys to rotate.",
    "You cannot disable the currently configured administrator account.",
    "Email delivery is not configured.",
    "Resend could not be reached.",
  ];
  if (safePrefixes.some((prefix) => error.message.startsWith(prefix))) return error.message;
  if (/^Resend rejected the message \(HTTP [0-9]{3}\)\./.test(error.message)) return error.message;
  return "Perminister could not complete that request. Check the Spaces and mail configuration, then try again.";
}

function firstValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function parseScope(data: FormData): ResourceScope {
  const kind = firstValue(data, "scopeKind");
  const productId = firstValue(data, "productId").trim();
  if (kind === "product") return { kind, productId };
  const resourceId = firstValue(data, "resourceId").trim();
  if (kind === "project") return { kind, productId, projectId: resourceId };
  if (kind === "workspace") return { kind, productId, workspaceId: resourceId };
  throw new Error("Choose a supported permission scope.");
}

function parseActions(data: FormData): string[] {
  return firstValue(data, "actions").split(",").map((value) => value.trim()).filter(Boolean);
}

export async function registerAction(formData: FormData): Promise<void> {
  const email = firstValue(formData, "email");
  const password = firstValue(formData, "password");
  if (password !== firstValue(formData, "confirmPassword")) redirect("/register?error=password-mismatch");
  let subject;
  try {
    subject = await registerAccount(email, password);
  } catch (error) {
    const message = publicActionError(error);
    const code = message.startsWith("An account with")
      ? "account-exists"
      : message.startsWith("Enter a valid email")
        ? "invalid-email"
        : message.startsWith("Use a password") || message.startsWith("Password must")
          ? "password-policy"
          : "registration-unavailable";
    redirect(`/register?error=${code}`);
  }

  let notice = "account-created-mail-unconfigured";
  if (isMailDeliveryConfigured()) {
    try {
      const verification = await issueEmailAction(subject.subjectId, "verify-email");
      if (verification) await sendVerificationEmail(verification.email, verification.token);
      notice = verification ? "verification-sent" : "account-created";
    } catch {
      notice = "verification-delivery-failed";
    }
  }

  try {
    const session = await createSession(subject.subjectId);
    await setSessionCookie(session.token);
  } catch {
    redirect(`/login?notice=${notice}`);
  }
  redirect(`/dashboard?notice=${notice}`);
}

export async function signInAction(formData: FormData): Promise<void> {
  try {
    const subject = await authenticate(firstValue(formData, "email"), firstValue(formData, "password"));
    const session = await createSession(subject.subjectId);
    await setSessionCookie(session.token);
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("Too many sign-in attempts")
      ? "throttled"
      : error instanceof Error && error.message === "Email or password is incorrect."
        ? "credentials"
        : "unavailable";
    redirect(`/login?error=${code}`);
  }
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();
  redirect("/");
}

export async function requestVerificationAction(): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (current.subject.emailVerifiedAt) redirect("/dashboard?notice=email-already-verified");
  if (!isMailDeliveryConfigured()) redirect("/dashboard?notice=mail-not-configured");
  let verification: { email: string; token: string } | null = null;
  try {
    verification = await issueEmailAction(current.subject.subjectId, "verify-email");
    if (verification) await sendVerificationEmail(verification.email, verification.token);
  } catch {
    redirect("/dashboard?notice=verification-delivery-failed");
  }
  if (!verification) redirect("/dashboard?notice=email-already-verified");
  redirect("/dashboard?notice=verification-sent");
}

export async function verifyEmailAction(formData: FormData): Promise<void> {
  try {
    await completeEmailAction(firstValue(formData, "token"), "verify-email");
  } catch {
    redirect("/verify-email?error=invalid-link");
  }
  redirect("/login?notice=email-verified");
}

export async function requestPasswordRecoveryAction(formData: FormData): Promise<void> {
  if (!isMailDeliveryConfigured()) redirect("/forgot-password?error=mail-not-configured");
  let delivery: { email: string; token: string } | null;
  try {
    delivery = await issueRecoveryAction(firstValue(formData, "email"));
  } catch {
    redirect("/forgot-password?error=invalid-email");
  }
  if (!delivery) redirect("/forgot-password?notice=requested");
  try {
    await sendRecoveryEmail(delivery.email, delivery.token);
  } catch {
    redirect("/forgot-password?error=delivery-failed");
  }
  redirect("/forgot-password?notice=requested");
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const password = firstValue(formData, "password");
  if (password !== firstValue(formData, "confirmPassword")) redirect("/reset-password?error=password-mismatch");
  try {
    await completeEmailAction(firstValue(formData, "token"), "recover-password", password);
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("Use a password")
      ? "password-policy"
      : "invalid-link";
    redirect(`/reset-password?error=${code}`);
  }
  redirect("/login?notice=password-reset");
}

export interface CreateApiKeyState {
  token?: string;
  warning?: string;
  error?: string;
}

export async function createApiKeyAction(
  _previous: CreateApiKeyState,
  formData: FormData,
): Promise<CreateApiKeyState> {
  const current = await getCurrentSession();
  if (!current) return { error: "Sign in again to create an API key." };
  try {
    const expiration = firstValue(formData, "expiresInDays");
    const expiresAt = expiration === "never"
      ? null
      : new Date(Date.now() + Number(expiration) * 24 * 60 * 60 * 1000).toISOString();
    const created = await createApiKeyForSubject(current.subject.subjectId, {
      scope: parseScope(formData),
      actions: parseActions(formData),
      expiresAt,
      rotateFromApiKeyId: firstValue(formData, "rotateFromApiKeyId") || undefined,
    });
    return { token: created.token, warning: created.rotationWarning ?? undefined };
  } catch (error) {
    return { error: publicActionError(error) };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  try {
    await revokeApiKeyForSubject(current.subject.subjectId, firstValue(formData, "apiKeyId"));
  } catch {
    redirect("/dashboard?notice=key-revoke-failed");
  }
  redirect("/dashboard?notice=key-revoked");
}

export async function createGrantAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard?notice=admin-required");
  try {
    await createPermissionGrant(
      current.subject.subjectId,
      firstValue(formData, "subjectId"),
      parseScope(formData),
      parseActions(formData),
    );
  } catch {
    redirect("/dashboard?notice=grant-failed");
  }
  redirect("/dashboard?notice=grant-created");
}

export async function updateGrantStatusAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard?notice=admin-required");
  const status = firstValue(formData, "status");
  if (status !== "active" && status !== "disabled") redirect("/dashboard?notice=grant-failed");
  try {
    await updateGrantStatus(current.subject.subjectId, firstValue(formData, "membershipId"), status);
  } catch {
    redirect("/dashboard?notice=grant-failed");
  }
  redirect("/dashboard?notice=grant-updated");
}

export async function updateAccountStatusAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard?notice=admin-required");
  const status = firstValue(formData, "status");
  if (status !== "active" && status !== "disabled") redirect("/dashboard?notice=account-update-failed");
  try {
    await updateAccountStatus(current.subject.subjectId, firstValue(formData, "subjectId"), status);
  } catch {
    redirect("/dashboard?notice=account-update-failed");
  }
  redirect("/dashboard?notice=account-updated");
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  try {
    const sessionId = firstValue(formData, "sessionId");
    await revokeSession(sessionId, current.subject.subjectId);
    const cookieStore = await cookies();
    if (sessionId === current.session.sessionId) cookieStore.delete("perminister_session");
  } catch {
    redirect("/dashboard?notice=session-revoke-failed");
  }
  redirect("/dashboard?notice=session-revoked");
}
