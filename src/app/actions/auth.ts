import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { consumerAuthRequestContext } from "@/lib/auth/consumer-auth-request-context";
import {
  consumePasswordRecoveryRateLimit,
  passwordRecoveryRequesterKey,
} from "@/lib/auth/coordination";
import {
  browserOriginFromHeaders,
  isMailDeliveryConfigured,
  sendRecoveryEmail,
  sendVerificationEmail,
} from "@/lib/auth/mail";
import {
  acceptOrganizationInvitation,
  completeEmailAction,
  createSession,
  getCurrentSession,
  issueEmailAction,
  issueRecoveryAction,
  registerAccount,
  setSessionCookie,
} from "@/lib/auth/service";
import { dashboardReturnTo, firstValue, publicActionError } from "./shared";

export async function registerAction(formData: FormData): Promise<void> {
  const email = firstValue(formData, "email");
  const password = firstValue(formData, "password");
  const invitationToken = firstValue(formData, "invitationToken");
  const { next, client, authorization } = await consumerAuthRequestContext(
    firstValue(formData, "next"),
    { ignoreLookupErrors: true },
  );
  const invitationQuery = invitationToken
    ? `&invitationToken=${encodeURIComponent(invitationToken)}`
    : "";
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";
  let consumerLoginIdentifier: { productId: string; username: string } | undefined;
  if (authorization && client?.productId.trim().toLowerCase() === "system-concepts") {
    if (!client.selfRegistrationEnabled) {
      redirect(`/register?error=registration-unavailable${invitationQuery}${nextQuery}`);
    }
    const username = firstValue(formData, "systemConceptsId").trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,254}$/.test(username)) {
      redirect(`/register?error=invalid-systemconcepts-id${invitationQuery}${nextQuery}`);
    }
    consumerLoginIdentifier = { productId: client.productId, username };
  }
  if (password !== firstValue(formData, "confirmPassword"))
    redirect(`/register?error=password-mismatch${invitationQuery}${nextQuery}`);
  let subject;
  try {
    subject = await registerAccount(
      email,
      password,
      {
        firstName: firstValue(formData, "firstName"),
        lastName: firstValue(formData, "lastName"),
      },
      consumerLoginIdentifier,
    );
  } catch (error) {
    const message = publicActionError(error);
    if (message.startsWith("An account with") && !invitationToken) {
      redirect(`/register?notice=registration-requested${invitationQuery}${nextQuery}`);
    }
    const code = message.startsWith("An account with")
      ? "account-exists"
      : message.startsWith("That System Concepts ID")
        ? "systemconcepts-id-in-use"
        : message.startsWith("Enter a valid email")
          ? "invalid-email"
          : message.startsWith("First name") || message.startsWith("Last name")
            ? "invalid-name"
            : message.startsWith("Use a password") || message.startsWith("Password must")
              ? "password-policy"
              : "registration-unavailable";
    redirect(`/register?error=${code}${invitationQuery}${nextQuery}`);
  }

  if (invitationToken) {
    let acceptedOrganizationId: string | null = null;
    try {
      acceptedOrganizationId = await acceptOrganizationInvitation(
        subject.subjectId,
        invitationToken,
      );
    } catch {
      // An invalid invitation does not verify a new account; normal email verification remains available.
    }
    if (acceptedOrganizationId) {
      try {
        const session = await createSession(subject.subjectId);
        await setSessionCookie(session.token);
      } catch {
        redirect("/login?notice=invitation-accepted-sign-in");
      }
      redirect(`/dashboard/${acceptedOrganizationId}?notice=invitation-accepted`);
    }
  }

  if (isMailDeliveryConfigured()) {
    const origin = browserOriginFromHeaders(await headers());
    after(async () => {
      try {
        const verification = await issueEmailAction(subject.subjectId, "verify-email");
        if (verification) {
          await sendVerificationEmail(verification.email, verification.token, { origin });
        }
      } catch {
        // Keep the registration response independent of account and delivery state.
      }
    });
  }
  redirect(`/register?notice=registration-requested${invitationQuery}${nextQuery}`);
}

export async function requestVerificationAction(formData: FormData): Promise<void> {
  const returnTo = dashboardReturnTo(formData);
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (current.subject.emailVerifiedAt) redirect(`${returnTo}?notice=email-already-verified`);
  if (!isMailDeliveryConfigured()) redirect(`${returnTo}?notice=mail-not-configured`);
  let verification: { email: string; token: string } | null = null;
  try {
    verification = await issueEmailAction(current.subject.subjectId, "verify-email");
    if (verification) {
      const origin = browserOriginFromHeaders(await headers());
      await sendVerificationEmail(verification.email, verification.token, { origin });
    }
  } catch {
    redirect(`${returnTo}?notice=verification-delivery-failed`);
  }
  if (!verification) redirect(`${returnTo}?notice=email-already-verified`);
  redirect(`${returnTo}?notice=verification-sent`);
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
  const email = firstValue(formData, "email");
  const requestHeaders = await headers();
  if (!(await consumePasswordRecoveryRateLimit(email, passwordRecoveryRequesterKey(requestHeaders)))) {
    redirect("/forgot-password?notice=requested");
  }
  after(async () => {
    try {
      const delivery = await issueRecoveryAction(email);
      if (delivery) await sendRecoveryEmail(delivery.email, delivery.token);
    } catch {
      // Keep recovery delivery and account existence out of the response.
    }
  });
  redirect("/forgot-password?notice=requested");
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const password = firstValue(formData, "password");
  if (password !== firstValue(formData, "confirmPassword"))
    redirect("/reset-password?error=password-mismatch");
  try {
    await completeEmailAction(firstValue(formData, "token"), "recover-password", password);
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith("Use a password")
        ? "password-policy"
        : "invalid-link";
    redirect(`/reset-password?error=${code}`);
  }
  redirect("/login?notice=password-reset");
}
