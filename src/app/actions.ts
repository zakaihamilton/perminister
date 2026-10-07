"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import {
  authenticate,
  acceptOrganizationInvitation,
  completeEmailAction,
  createApiKeyForSubject,
  createConsumerClient,
  createOrganization,
  createOrganizationInvitation,
  createOrganizationProduct,
  createProductAccessRole,
  createProductInvitation,
  createPermissionGrant,
  createSession,
  getCurrentSession,
  getOrganizationForSubject,
  isAdministrator,
  decideOrganizationRequest,
  issueEmailAction,
  issueRecoveryAction,
  registerAccount,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  revokeProductInvitation,
  retireLegacyAccess,
  revokeApiKeyForSubject,
  revokeConsumerClient,
  revokeSession,
  setSessionCookie,
  signOutCurrentSession,
  updateAccountStatus,
  updateAccountProfile,
  updateGrantStatus,
  updateOrganizationMemberRole,
  updateOrganizationName,
  updateOrganizationProduct,
  updateProductMemberRole,
  removeProductMember,
  removeProductAccessRole,
  rotateConsumerClient,
} from "@/lib/auth/service";
import type { ResourceScope, SubjectId } from "@/lib/auth/domain";
import type { ConsumerClientCredential } from "@/lib/auth/service";
import {
  browserOriginFromHeaders,
  isMailDeliveryConfigured,
  sendRecoveryEmail,
  sendOrganizationInvitationEmail,
  sendProductInvitationEmail,
  sendVerificationEmail,
} from "@/lib/auth/mail";
import {
  consumePasswordRecoveryRateLimit,
  consumeProductLookupRateLimit,
  passwordRecoveryRequesterKey,
} from "@/lib/auth/coordination";

function publicActionError(error: unknown): string {
  if (!(error instanceof Error)) return "Perminister could not complete that request.";
  const safePrefixes = [
    "An account with this email address already exists.",
    "Email or password is incorrect.",
    "Too many sign-in attempts.",
    "Use a password",
    "Password must be",
    "Enter a valid email address.",
    "First name must be 80 characters or fewer.",
    "Last name must be 80 characters or fewer.",
    "Enter a valid product ID.",
    "Enter a valid project ID.",
    "Enter a valid workspace ID.",
    "Enter 1 to 32 valid action names.",
    "Choose a future expiration time.",
    "Choose an active account.",
    "Choose an active, email-verified account.",
    "An active, email-verified account is required to create an API key.",
    "Join this organization before creating an API key.",
    "API keys can only include actions granted to your account.",
    "Choose a product in this organization.",
    "Choose a member of this organization.",
    "Choose a member of this product.",
    "This person is already a product member.",
    "Only a product owner can invite a product administrator.",
    "A product must keep at least one owner.",
    "You do not have permission to manage this product.",
    "Join this product before creating an API key.",
    "This person is already a member of the organization.",
    "Only an organization owner can invite an administrator.",
    "An organization must keep at least one owner.",
    "You do not have permission to manage this organization.",
    "That product ID is already in use in this organization.",
    "Use a product ID with letters, numbers, dots, underscores, colons, or hyphens.",
    "Enter a product name up to 120 characters.",
    "The product description must be 500 characters or fewer.",
    "Organization names must be 2 to 80 characters.",
    "This invitation is invalid or expired, or it was sent to another email address.",
    "Only an active, unexpired API key can be rotated.",
    "Enter an application name up to 80 characters.",
    "Enter a valid app origin.",
    "Use an HTTPS app origin without a path, query, or fragment.",
    "Session lifetime must be between 5 minutes and 90 days.",
    "Choose whether self-registration is enabled.",
    "Public self-registration is disabled for this product.",
    "Choose an active application client for this product.",
    "Application client not found.",
    "Choose one of your own API keys to rotate.",
    "You cannot disable the currently configured administrator account.",
    "Email delivery is not configured.",
    "Resend could not be reached.",
    "Enter a valid website address.",
    "Use a public HTTPS website address.",
    "This website cannot be fetched because it does not resolve to a public address.",
    "The website redirected too many times.",
    "This website returned too much content to import.",
    "The website could not be fetched. Enter its details manually.",
    "This address did not return a web page. Enter its details manually.",
    "Website could not be resolved. Enter its details manually.",
    "Product website request timed out.",
    "Too many product lookups. Try again in a minute.",
    "Organization is busy. Try again shortly.",
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
  const organizationId = firstValue(data, "organizationId");
  const productId = firstValue(data, "productId").trim();
  if (kind === "product")
    return { kind, organizationId: organizationId as ResourceScope["organizationId"], productId };
  const resourceId = firstValue(data, "resourceId").trim();
  if (kind === "project")
    return {
      kind,
      organizationId: organizationId as ResourceScope["organizationId"],
      productId,
      projectId: resourceId,
    };
  if (kind === "workspace")
    return {
      kind,
      organizationId: organizationId as ResourceScope["organizationId"],
      productId,
      workspaceId: resourceId,
    };
  throw new Error("Choose a supported permission scope.");
}

function parseActions(data: FormData): string[] {
  return firstValue(data, "actions")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function dashboardReturnTo(data: FormData): string {
  const value = firstValue(data, "returnTo");
  return value.startsWith("/dashboard/") || value === "/dashboard" ? value : "/dashboard";
}

export async function registerAction(formData: FormData): Promise<void> {
  const email = firstValue(formData, "email");
  const password = firstValue(formData, "password");
  const invitationToken = firstValue(formData, "invitationToken");
  const invitationQuery = invitationToken
    ? `&invitationToken=${encodeURIComponent(invitationToken)}`
    : "";
  if (password !== firstValue(formData, "confirmPassword"))
    redirect(`/register?error=password-mismatch${invitationQuery}`);
  let subject;
  try {
    subject = await registerAccount(email, password, {
      firstName: firstValue(formData, "firstName"),
      lastName: firstValue(formData, "lastName"),
    });
  } catch (error) {
    const message = publicActionError(error);
    const code = message.startsWith("An account with")
      ? "account-exists"
      : message.startsWith("Enter a valid email")
        ? "invalid-email"
        : message.startsWith("First name") || message.startsWith("Last name")
          ? "invalid-name"
          : message.startsWith("Use a password") || message.startsWith("Password must")
            ? "password-policy"
            : "registration-unavailable";
    redirect(`/register?error=${code}${invitationQuery}`);
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

  let notice = "account-created-mail-unconfigured";
  if (isMailDeliveryConfigured()) {
    try {
      const verification = await issueEmailAction(subject.subjectId, "verify-email");
      if (verification) {
        const origin = browserOriginFromHeaders(await headers());
        await sendVerificationEmail(verification.email, verification.token, { origin });
      }
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
  const invitationToken = firstValue(formData, "invitationToken");
  const invitationQuery = invitationToken
    ? `&invitationToken=${encodeURIComponent(invitationToken)}`
    : "";
  try {
    const subject = await authenticate(
      firstValue(formData, "email"),
      firstValue(formData, "password"),
    );
    const session = await createSession(subject.subjectId);
    await setSessionCookie(session.token);
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith("Too many sign-in attempts")
        ? "throttled"
        : error instanceof Error && error.message === "Email or password is incorrect."
          ? "credentials"
          : "unavailable";
    redirect(`/login?error=${code}${invitationQuery}`);
  }
  redirect(
    invitationToken
      ? `/accept-invitation?token=${encodeURIComponent(invitationToken)}`
      : "/dashboard",
  );
}

export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();
  redirect("/");
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
  if (!consumePasswordRecoveryRateLimit(email, passwordRecoveryRequesterKey(requestHeaders))) {
    redirect("/forgot-password?notice=requested");
  }
  const origin = requestHeaders.get("origin");
  after(async () => {
    try {
      const delivery = await issueRecoveryAction(email);
      if (delivery) await sendRecoveryEmail(delivery.email, delivery.token, { origin });
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
    const expiresAt =
      expiration === "never"
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

export interface ConsumerClientActionState {
  clientId?: string;
  secret?: string;
  error?: string;
}

export async function createOrRotateConsumerClientAction(
  _previous: ConsumerClientActionState,
  formData: FormData,
): Promise<ConsumerClientActionState> {
  const current = await getCurrentSession();
  if (!current) return { error: "Sign in again to manage application clients." };
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const returnTo = dashboardReturnTo(formData);
  const clientId = firstValue(formData, "clientId");
  try {
    let credential: ConsumerClientCredential;
    if (clientId) {
      credential = await rotateConsumerClient(
        current.subject.subjectId,
        organizationId,
        productId,
        clientId,
      );
    } else {
      const sessionLifetimeHours = Number(firstValue(formData, "sessionLifetimeHours"));
      const registrationSetting = firstValue(formData, "selfRegistrationEnabled");
      if (registrationSetting !== "true" && registrationSetting !== "false") {
        return { error: "Choose whether self-registration is enabled." };
      }
      credential = await createConsumerClient(
        current.subject.subjectId,
        organizationId,
        productId,
        {
          appName: firstValue(formData, "appName"),
          appOrigin: firstValue(formData, "appOrigin"),
          sessionLifetimeSeconds: Math.round(sessionLifetimeHours * 60 * 60),
          selfRegistrationEnabled: registrationSetting === "true",
        },
      );
    }
    revalidatePath(returnTo);
    return credential;
  } catch (error) {
    return { error: publicActionError(error) };
  }
}

export async function revokeConsumerClientAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const clientId = firstValue(formData, "clientId");
  const returnTo = dashboardReturnTo(formData);
  try {
    await revokeConsumerClient(current.subject.subjectId, organizationId, productId, clientId);
  } catch (error) {
    const message = encodeURIComponent(publicActionError(error));
    redirect(`${returnTo}?error=${message}`);
  }
  revalidatePath(returnTo);
  redirect(`${returnTo}?notice=client-revoked`);
}

export async function createOrganizationAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const returnTo = dashboardReturnTo(formData);
  try {
    await createOrganization(current.subject.subjectId, firstValue(formData, "name"));
  } catch (error) {
    const code =
      error instanceof Error && error.message === "An organization request is already pending."
        ? "organization-pending"
        : "organization-create";
    redirect(`${returnTo}?error=${code}`);
  }
  redirect(`${returnTo}?notice=organization-pending`);
}

export async function reviewOrganizationRequestAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard?notice=admin-required");
  const approvalStatus = firstValue(formData, "approvalStatus");
  if (approvalStatus !== "approved" && approvalStatus !== "rejected") {
    redirect("/dashboard/operations?error=organization-review");
  }
  try {
    await decideOrganizationRequest(
      current.subject.subjectId,
      firstValue(formData, "organizationId"),
      approvalStatus,
    );
  } catch {
    redirect("/dashboard/operations?error=organization-review");
  }
  redirect(`/dashboard/operations?notice=organization-${approvalStatus}`);
}

export async function createOrganizationProductAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  let productId: string;
  try {
    const product = await createOrganizationProduct(current.subject.subjectId, organizationId, {
      productId: firstValue(formData, "productId"),
      name: firstValue(formData, "name"),
      description: firstValue(formData, "description"),
      websiteUrl: firstValue(formData, "websiteUrl"),
      iconUrl: firstValue(formData, "iconUrl"),
    });
    productId = product.productId;
  } catch (error) {
    const message = encodeURIComponent(publicActionError(error));
    redirect(`/dashboard/${organizationId}/products/new?error=${message}`);
  }
  redirect(
    `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}?notice=product-created`,
  );
}

export async function updateOrganizationProductAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  let productId: string;
  try {
    const product = await updateOrganizationProduct(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "productRecordId"),
      {
        name: firstValue(formData, "name"),
        description: firstValue(formData, "description"),
        websiteUrl: firstValue(formData, "websiteUrl"),
        iconUrl: firstValue(formData, "iconUrl"),
      },
    );
    productId = product.productId;
  } catch {
    redirect(`/dashboard/${organizationId}/products?error=product-update`);
  }
  redirect(
    `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}?notice=product-updated`,
  );
}

export interface ProductLookupState {
  error?: string;
  suggestion?: { name: string; description: string; websiteUrl: string; iconUrl: string };
  source?: string;
}

export async function lookupProductWebsiteAction(
  _previous: ProductLookupState,
  formData: FormData,
): Promise<ProductLookupState> {
  const source = firstValue(formData, "source").trim();
  const organizationId = firstValue(formData, "organizationId");
  if (!source || source.length > 2048) {
    return { error: "Enter a website address up to 2,048 characters.", source };
  }
  const current = await getCurrentSession();
  if (!current) return { error: "Sign in before looking up product details.", source };
  try {
    const organization = await getOrganizationForSubject(current.subject.subjectId, organizationId);
    if (organization.membership.role !== "owner" && organization.membership.role !== "admin") {
      return { error: "Only organization owners and admins can look up product details.", source };
    }
    if (!(await consumeProductLookupRateLimit(organizationId, current.subject.subjectId))) {
      return { error: "Too many product lookups. Try again in a minute.", source };
    }
    const { fetchProductSiteSuggestion } = await import("@/lib/product-discovery");
    const suggestion = await fetchProductSiteSuggestion(source);
    return { suggestion, source: suggestion.websiteUrl };
  } catch (error) {
    return { error: publicActionError(error), source };
  }
}

export async function inviteOrganizationMemberAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  if (!isMailDeliveryConfigured())
    redirect(`/dashboard/${organizationId}/people?error=mail-unconfigured`);
  if (firstValue(formData, "role") !== "admin")
    redirect(`/dashboard/${organizationId}/people?error=invite-failed`);
  try {
    const result = await createOrganizationInvitation(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "email"),
      "admin",
    );
    await sendOrganizationInvitationEmail(
      result.invitation.email,
      result.token,
      result.organizationName,
      result.invitation.role,
      { origin: browserOriginFromHeaders(await headers()) },
    );
  } catch (error) {
    const message = publicActionError(error);
    const code =
      message === "Email delivery is not configured. No email was sent."
        ? "mail-unconfigured"
        : "invite-failed";
    redirect(`/dashboard/${organizationId}/people?error=${code}`);
  }
  redirect(`/dashboard/${organizationId}/people?notice=invite-sent`);
}

export async function inviteProductMemberAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const productPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`;
  if (!isMailDeliveryConfigured()) redirect(`${productPath}?error=mail-unconfigured`);
  const role = firstValue(formData, "role");
  if (role !== "admin" && role !== "member") redirect(`${productPath}?error=invite-failed`);
  try {
    const result = await createProductInvitation(
      current.subject.subjectId,
      organizationId,
      productId,
      firstValue(formData, "email"),
      role,
    );
    await sendProductInvitationEmail(
      result.invitation.email,
      result.token,
      result.productName,
      result.invitation.role,
      { origin: browserOriginFromHeaders(await headers()) },
    );
  } catch (error) {
    const message = publicActionError(error);
    const code =
      message === "Email delivery is not configured. No email was sent."
        ? "mail-unconfigured"
        : "invite-failed";
    redirect(`${productPath}?error=${code}`);
  }
  redirect(`${productPath}?notice=invite-sent`);
}

export async function acceptOrganizationInvitationAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current)
    redirect(`/login?invitationToken=${encodeURIComponent(firstValue(formData, "token"))}`);
  const token = firstValue(formData, "token");
  let organizationId: string;
  try {
    organizationId = await acceptOrganizationInvitation(current.subject.subjectId, token);
  } catch {
    redirect(`/accept-invitation?token=${encodeURIComponent(token)}&error=invalid`);
  }
  redirect(`/dashboard/${organizationId}?notice=invitation-accepted`);
}

export async function updateOrganizationMemberRoleAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const role = firstValue(formData, "role");
  if (role !== "owner" && role !== "admin")
    redirect(`/dashboard/${organizationId}/people?error=member-update`);
  try {
    await updateOrganizationMemberRole(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "membershipId"),
      role,
    );
  } catch {
    redirect(`/dashboard/${organizationId}/people?error=member-update`);
  }
  redirect(`/dashboard/${organizationId}/people?notice=member-updated`);
}

export async function updateProductMemberRoleAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const productPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`;
  const role = firstValue(formData, "role");
  if (role !== "owner" && role !== "admin" && role !== "member") {
    redirect(`${productPath}?error=member-update`);
  }
  try {
    await updateProductMemberRole(
      current.subject.subjectId,
      organizationId,
      productId,
      firstValue(formData, "subjectId"),
      role,
    );
  } catch {
    redirect(`${productPath}?error=member-update`);
  }
  redirect(`${productPath}?notice=member-updated`);
}

export async function removeProductMemberAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const productPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`;
  try {
    await removeProductMember(
      current.subject.subjectId,
      organizationId,
      productId,
      firstValue(formData, "subjectId"),
    );
  } catch {
    redirect(`${productPath}?error=member-remove`);
  }
  redirect(`${productPath}?notice=member-removed`);
}

export async function revokeProductInvitationAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const productPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`;
  try {
    await revokeProductInvitation(
      current.subject.subjectId,
      organizationId,
      productId,
      firstValue(formData, "invitationId"),
    );
  } catch {
    redirect(`${productPath}?error=invite-revoke`);
  }
  redirect(`${productPath}?notice=invite-revoked`);
}

export async function removeOrganizationMemberAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  try {
    await removeOrganizationMember(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "membershipId"),
    );
  } catch {
    redirect(`/dashboard/${organizationId}/people?error=member-remove`);
  }
  redirect(`/dashboard/${organizationId}/people?notice=member-removed`);
}

export async function revokeOrganizationInvitationAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  try {
    await revokeOrganizationInvitation(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "invitationId"),
    );
  } catch {
    redirect(`/dashboard/${organizationId}/people?error=invite-revoke`);
  }
  redirect(`/dashboard/${organizationId}/people?notice=invite-revoked`);
}

export async function updateOrganizationNameAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  try {
    await updateOrganizationName(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "name"),
    );
  } catch {
    redirect(`/dashboard/${organizationId}/settings?error=settings`);
  }
  redirect(`/dashboard/${organizationId}/settings?notice=settings-saved`);
}

export async function updateAccountProfileAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const returnTo = dashboardReturnTo(formData);
  try {
    await updateAccountProfile(current.subject.subjectId, {
      firstName: firstValue(formData, "firstName"),
      lastName: firstValue(formData, "lastName"),
    });
  } catch {
    redirect(`${returnTo}?error=profile`);
  }
  redirect(`${returnTo}?notice=profile-saved`);
}

export async function retireLegacyAccessAction(): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");
  let retired: { grants: number; keys: number };
  try {
    retired = await retireLegacyAccess(current.subject.subjectId);
  } catch {
    redirect("/dashboard/operations?error=migration");
  }
  redirect(`/dashboard/operations?retired=${retired.grants},${retired.keys}`);
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  try {
    await revokeApiKeyForSubject(current.subject.subjectId, firstValue(formData, "apiKeyId"));
  } catch {
    redirect(`${dashboardReturnTo(formData)}?error=key-revoke-failed`);
  }
  redirect(`${dashboardReturnTo(formData)}?notice=key-revoked`);
}

export async function createGrantAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  try {
    const accessRoleId = firstValue(formData, "accessRoleId").trim();
    await createPermissionGrant(
      current.subject.subjectId,
      firstValue(formData, "subjectId"),
      parseScope(formData),
      accessRoleId ? [] : parseActions(formData),
      accessRoleId || undefined,
    );
  } catch {
    redirect(
      `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access?error=grant-failed`,
    );
  }
  redirect(
    `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access?notice=grant-created`,
  );
}

async function runProductAccessRoleAction(
  formData: FormData,
  notice: "access-role-created" | "access-role-removed",
  mutation: (subjectId: SubjectId, organizationId: string, productId: string) => Promise<unknown>,
): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const rolesPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`;
  try {
    await mutation(current.subject.subjectId, organizationId, productId);
  } catch {
    redirect(`${rolesPath}?error=access-role`);
  }
  redirect(`${rolesPath}?notice=${notice}`);
}

export async function createProductAccessRoleAction(formData: FormData): Promise<void> {
  await runProductAccessRoleAction(
    formData,
    "access-role-created",
    (subjectId, organizationId, productId) =>
      createProductAccessRole(subjectId, organizationId, productId, {
        name: firstValue(formData, "roleName"),
        description: firstValue(formData, "roleDescription"),
        actions: firstValue(formData, "actions").split(/[\n,]/),
      }),
  );
}

export async function removeProductAccessRoleAction(formData: FormData): Promise<void> {
  await runProductAccessRoleAction(
    formData,
    "access-role-removed",
    (subjectId, organizationId, productId) =>
      removeProductAccessRole(
        subjectId,
        organizationId,
        productId,
        firstValue(formData, "accessRoleId"),
      ),
  );
}

export async function updateGrantStatusAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const status = firstValue(formData, "status");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const accessPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`;
  if (status !== "active" && status !== "disabled") redirect(`${accessPath}?error=grant-failed`);
  try {
    await updateGrantStatus(
      current.subject.subjectId,
      firstValue(formData, "membershipId"),
      status,
    );
  } catch {
    redirect(`${accessPath}?error=grant-failed`);
  }
  redirect(`${accessPath}?notice=grant-updated`);
}

export async function updateAccountStatusAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard?notice=admin-required");
  const status = firstValue(formData, "status");
  if (status !== "active" && status !== "disabled")
    redirect("/dashboard?notice=account-update-failed");
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
    redirect(`${dashboardReturnTo(formData)}?notice=session-revoke-failed`);
  }
  redirect(`${dashboardReturnTo(formData)}?notice=session-revoked`);
}
