import "server-only";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { consumerAuthRequestContext } from "@/lib/auth/consumer-auth-request-context";
import {
  consumePasswordRecoveryRateLimit,
  consumeProductLookupRateLimit,
  passwordRecoveryRequesterKey,
} from "@/lib/auth/coordination";
import type { ProductVisibility, ResourceScope, SubjectId } from "@/lib/auth/domain";
import {
  browserOriginFromHeaders,
  isMailDeliveryConfigured,
  sendOrganizationInvitationEmail,
  sendProductInvitationEmail,
  sendRecoveryEmail,
  sendVerificationEmail,
} from "@/lib/auth/mail";
import {
  acceptOrganizationInvitation,
  addExistingProductMemberByEmail,
  applyProductAccessRoleCatalog,
  archiveOrganizationProduct,
  completeEmailAction,
  completeOrganizationInvitationResend,
  createApiKeyForSubject,
  createConsumerClient,
  createOrganization,
  createOrganizationInvitation,
  createOrganizationProduct,
  createPermissionGrant,
  createProductAccessRole,
  createProductInvitation,
  createSession,
  decideOrganizationRequest,
  deleteAccountForAdministrator,
  deleteOrganizationProduct,
  deletePermissionGrant,
  getCurrentSession,
  getOrganizationForSubject,
  getProductMoveRecoveryState,
  getProductShareInfo,
  installPublicProduct,
  isAdministrator,
  issueEmailAction,
  issueRecoveryAction,
  prepareOrganizationInvitationResend,
  registerAccount,
  removeOrganizationMember,
  removeProductAccessRole,
  removeProductMember,
  restoreOrganizationProduct,
  movePrivateProductForOrganizationOwner,
  retireLegacyAccess,
  revokeApiKeyForSubject,
  revokeConsumerClient,
  revokeOrganizationInvitation,
  revokeProductInvitation,
  revokeSession,
  rotateConsumerClient,
  setOrganizationProductVisibility,
  setSessionCookie,
  stageProductAccessRoleCatalog,
  transferPublicProductForAdministrator,
  transferPublicProductForOrganizationOwner,
  updateAccountProfile,
  updateAccountStatus,
  updateConsumerClient,
  updateGrantStatus,
  updateOrganizationMemberRole,
  updateOrganizationName,
  updateOrganizationProduct,
  updateProductAccessRole,
  updateProductMemberRole,
} from "@/lib/auth/service";
import { operationsHref } from "@/lib/operations-navigation";

function publicActionError(error: unknown): string {
  if (!(error instanceof Error)) return "Perminister could not complete that request.";
  const safePrefixes = [
    "An account with this email address already exists.",
    "That System Concepts ID is already in use.",
    "Email or password is incorrect.",
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
    "A different product with this ID already exists in this organization. Resolve that conflict before adding the shared product.",
    "This public product is no longer available.",
    "This product is archived. Restore it before making changes.",
    "Archive this product before deleting it.",
    "Confirm removing the product from its installed organizations.",
    "Product installations changed. Retry deleting the archived product.",
    "A product being deleted cannot be restored.",
    "The product publisher is no longer available to restore this product.",
    "Another organization now publishes a product with this ID. This archived product cannot be restored while that publisher is active.",
    "This product is already being deleted.",
    "Shared product details are controlled by the publishing organization.",
    "Shared access roles are controlled by the publishing organization.",
    "App clients are managed by the product publisher.",
    "Confirm making this product private to remove it and revoke access in other organizations.",
    "Choose public or private product visibility.",
    "Only a public publisher product can be transferred.",
    "Only an active private product can be moved directly.",
    "A product with this ID already exists in the destination organization.",
    "The destination already has data for this product ID.",
    "Remove shared product installations before moving this product.",
    "Resume the product move to its existing destination.",
    "A product move is in progress. Resume it before making changes.",
    "This product ID is reserved by an incomplete move. Resume it first.",
    "Choose a different destination organization.",
    "Choose an approved destination organization.",
    "The destination already has a product with this product ID.",
    "This product has an incomplete transfer. Resume it at its existing destination first.",
    "The previous transfer cannot be resumed safely.",
    "Use a product ID with letters, numbers, dots, underscores, colons, or hyphens.",
    "Enter a product name up to 120 characters.",
    "The product description must be 500 characters or fewer.",
    "Organization names must be 2 to 80 characters.",
    "This invitation is invalid or expired, or it was sent to another email address.",
    "Only an active, unexpired API key can be rotated.",
    "Enter an application name up to 80 characters.",
    "Enter a valid app origin.",
    "Use an HTTPS app origin, or an HTTP localhost or 127.0.0.1 origin, without a path, query, or fragment.",
    "Session lifetime must be between 5 minutes and 30 days.",
    "Choose whether self-registration is enabled.",
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

function revalidateTransferredProductPaths(transfer: {
  affectedOrganizationIds: string[];
  product: { productId: string };
}): void {
  revalidatePath("/dashboard/operations/shared-products");
  for (const organizationId of transfer.affectedOrganizationIds) {
    revalidatePath(`/dashboard/${encodeURIComponent(organizationId)}/products`);
    revalidatePath(
      `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(transfer.product.productId)}`,
    );
  }
}

function revalidateProductLifecyclePaths(
  organizationIds: readonly string[],
  productId: string,
): void {
  revalidatePath("/dashboard/operations/shared-products");
  for (const organizationId of new Set(organizationIds)) {
    const organizationPath = `/dashboard/${encodeURIComponent(organizationId)}`;
    const productPath = `${organizationPath}/products/${encodeURIComponent(productId)}`;
    revalidatePath(organizationPath);
    revalidatePath(`${organizationPath}/products`);
    revalidatePath(productPath);
    revalidatePath(`${organizationPath}/api-keys`);
    revalidatePath(`${organizationPath}/api-keys/new`);
  }
}

function firstValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

async function requireOperationsAdministratorContext(
  formData: FormData,
  administratorRequiredPath = "/dashboard",
) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect(administratorRequiredPath);
  return {
    current,
    organizationId: firstValue(formData, "operationsOrganizationId"),
  };
}

async function updateOrganizationProductArchivedState(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  productId: string,
  updateState: typeof archiveOrganizationProduct,
): Promise<void> {
  let affectedOrganizationIds = [organizationId];
  try {
    const shareInfo = await getProductShareInfo(actorId, organizationId, productRecordId).catch(
      () => null,
    );
    await updateState(actorId, organizationId, productRecordId);
    affectedOrganizationIds = [
      organizationId,
      ...(shareInfo?.adopterOrganizations.map((entry) => entry.organizationId) ?? []),
    ];
  } catch (error) {
    redirect(
      `/dashboard/${encodeURIComponent(organizationId)}/products?error=product-lifecycle&reason=${encodeURIComponent(publicActionError(error))}`,
    );
  }
  revalidateProductLifecyclePaths(affectedOrganizationIds, productId);
}

async function updateOrganizationProductArchivedStateAction(
  formData: FormData,
  updateState: typeof archiveOrganizationProduct,
  notice: string,
): Promise<void> {
  const { current, organizationId, productRecordId, productId } =
    await organizationProductActionContext(formData);
  await updateOrganizationProductArchivedState(
    current.subject.subjectId,
    organizationId,
    productRecordId,
    productId,
    updateState,
  );
  redirect(`/dashboard/${encodeURIComponent(organizationId)}/products?notice=${notice}`);
}

function parseScope(data: FormData): ResourceScope {
  const kind = firstValue(data, "scopeKind");
  const organizationId = firstValue(data, "organizationId").toLowerCase();
  const productId = firstValue(data, "productId").trim().toLowerCase();
  if (kind === "product")
    return { kind, organizationId: organizationId as ResourceScope["organizationId"], productId };
  const resourceId = firstValue(data, "resourceId").trim().toLowerCase();
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

async function organizationProductActionContext(formData: FormData) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  return {
    current,
    organizationId: firstValue(formData, "organizationId"),
    productRecordId: firstValue(formData, "productRecordId"),
    productId: firstValue(formData, "productId"),
  };
}

async function productPeopleActionContext(formData: FormData) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  return {
    current,
    organizationId,
    productId,
    productPath: `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`,
  };
}

async function mutateProductPeopleRecord(
  formData: FormData,
  targetField: string,
  errorCode: string,
  noticeCode: string,
  mutation: (
    actorId: SubjectId,
    organizationId: string,
    productId: string,
    targetId: string,
  ) => Promise<void>,
): Promise<void> {
  const { current, organizationId, productId, productPath } =
    await productPeopleActionContext(formData);
  try {
    await mutation(
      current.subject.subjectId,
      organizationId,
      productId,
      firstValue(formData, targetField),
    );
  } catch {
    redirect(`${productPath}?error=${errorCode}`);
  }
  redirect(`${productPath}?notice=${noticeCode}`);
}

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
    subject = await registerAccount(email, password, {
      firstName: firstValue(formData, "firstName"),
      lastName: firstValue(formData, "lastName"),
    }, consumerLoginIdentifier);
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
  if (!consumePasswordRecoveryRateLimit(email, passwordRecoveryRequesterKey(requestHeaders))) {
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
  updated?: boolean;
  error?: string;
}

export interface ProductAccessRoleActionState {
  updated?: boolean;
  error?: string;
}

async function consumerClientActionContext(formData: FormData) {
  const current = await getCurrentSession();
  if (!current) return null;
  return {
    current,
    organizationId: firstValue(formData, "organizationId"),
    productId: firstValue(formData, "productId"),
    clientId: firstValue(formData, "clientId"),
    returnTo: dashboardReturnTo(formData),
  };
}

function consumerClientSettings(formData: FormData) {
  const sessionLifetimeHours = Number(firstValue(formData, "sessionLifetimeHours"));
  const registrationSetting = firstValue(formData, "selfRegistrationEnabled");
  if (registrationSetting !== "true" && registrationSetting !== "false") return null;
  return {
    appName: firstValue(formData, "appName"),
    appOrigin: firstValue(formData, "appOrigin"),
    redirectUris: formLines(formData, "redirectUris"),
    resourceUris: formLines(formData, "resourceUris"),
    oauthScopes: formLines(formData, "oauthScopes").flatMap((line) => line.split(/\s+/)),
    sessionLifetimeSeconds: Math.round(sessionLifetimeHours * 60 * 60),
    selfRegistrationEnabled: registrationSetting === "true",
  };
}

function formLines(formData: FormData, name: string): string[] {
  return firstValue(formData, name)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function manageConsumerClientAction(
  formData: FormData,
  operation: "create-or-rotate" | "update",
): Promise<ConsumerClientActionState> {
  const context = await consumerClientActionContext(formData);
  if (!context) return { error: "Sign in again to manage application clients." };
  const { current, organizationId, productId, returnTo, clientId } = context;

  try {
    if (operation === "update") {
      const settings = consumerClientSettings(formData);
      if (!settings) {
        return { clientId, error: "Choose whether self-registration is enabled." };
      }
      await updateConsumerClient(
        current.subject.subjectId,
        organizationId,
        productId,
        clientId,
        settings,
      );
      revalidatePath(returnTo);
      return { clientId, updated: true };
    }

    if (clientId) {
      const credential = await rotateConsumerClient(
        current.subject.subjectId,
        organizationId,
        productId,
        clientId,
      );
      revalidatePath(returnTo);
      return credential;
    }

    const settings = consumerClientSettings(formData);
    if (!settings) return { error: "Choose whether self-registration is enabled." };
    const credential = await createConsumerClient(
      current.subject.subjectId,
      organizationId,
      productId,
      settings,
    );
    revalidatePath(returnTo);
    return credential;
  } catch (error) {
    return {
      ...(operation === "update" ? { clientId } : {}),
      error: publicActionError(error),
    };
  }
}

export async function createOrRotateConsumerClientAction(
  _previous: ConsumerClientActionState,
  formData: FormData,
): Promise<ConsumerClientActionState> {
  return manageConsumerClientAction(formData, "create-or-rotate");
}

export async function updateConsumerClientAction(
  _previous: ConsumerClientActionState,
  formData: FormData,
): Promise<ConsumerClientActionState> {
  return manageConsumerClientAction(formData, "update");
}

export async function revokeConsumerClientAction(formData: FormData): Promise<void> {
  const context = await consumerClientActionContext(formData);
  if (!context) redirect("/login");
  const { current, organizationId, productId, clientId, returnTo } = context;
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
  const { current, organizationId: operationsOrganizationId } =
    await requireOperationsAdministratorContext(formData, "/dashboard?notice=admin-required");
  const approvalStatus = firstValue(formData, "approvalStatus");
  if (approvalStatus !== "approved" && approvalStatus !== "rejected") {
    redirect(
      operationsHref(
        "/dashboard/operations/organization-requests?error=organization-review",
        operationsOrganizationId,
      ),
    );
  }
  try {
    await decideOrganizationRequest(
      current.subject.subjectId,
      firstValue(formData, "organizationId"),
      approvalStatus,
    );
  } catch {
    redirect(
      operationsHref(
        "/dashboard/operations/organization-requests?error=organization-review",
        operationsOrganizationId,
      ),
    );
  }
  revalidatePath("/dashboard", "layout");
  redirect(
    operationsHref(
      `/dashboard/operations/organization-requests?notice=organization-${approvalStatus}`,
      operationsOrganizationId,
    ),
  );
}

export async function createOrganizationProductAction(formData: FormData): Promise<void> {
  const { current, organizationId } = await organizationProductActionContext(formData);
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
  const { current, organizationId } = await organizationProductActionContext(formData);
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

export async function addPublicProductAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  let product: Awaited<ReturnType<typeof installPublicProduct>>;
  try {
    product = await installPublicProduct(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "sourceProductRecordId"),
    );
  } catch (error) {
    redirect(
      `/dashboard/${organizationId}/products?error=${encodeURIComponent(publicActionError(error))}`,
    );
  }
  revalidatePath(`/dashboard/${organizationId}/products`);
  redirect(
    `/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}?notice=product-added`,
  );
}

export async function transferPublicProductAction(formData: FormData): Promise<void> {
  const { current, organizationId: operationsOrganizationId } =
    await requireOperationsAdministratorContext(formData);

  let transfer: Awaited<ReturnType<typeof transferPublicProductForAdministrator>>;
  try {
    transfer = await transferPublicProductForAdministrator(
      current.subject.subjectId,
      firstValue(formData, "productRecordId"),
      firstValue(formData, "destinationOrganizationId"),
    );
  } catch (error) {
    const message = encodeURIComponent(publicActionError(error));
    redirect(
      operationsHref(
        `/dashboard/operations/shared-products?error=product-transfer&reason=${message}`,
        operationsOrganizationId,
      ),
    );
  }

  revalidateTransferredProductPaths(transfer);
  redirect(
    operationsHref(
      "/dashboard/operations/shared-products?notice=product-transferred",
      operationsOrganizationId,
    ),
  );
}

export async function transferOwnedPublicProductAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const sourceOrganizationId = firstValue(formData, "sourceOrganizationId");
  const productRecordId = firstValue(formData, "productRecordId");
  const productId = firstValue(formData, "productId");
  const returnTo = `/dashboard/${encodeURIComponent(sourceOrganizationId)}/products/${encodeURIComponent(
    productId,
  )}`;

  let transfer: Awaited<ReturnType<typeof transferPublicProductForOrganizationOwner>>;
  try {
    transfer = await transferPublicProductForOrganizationOwner(
      current.subject.subjectId,
      sourceOrganizationId,
      productRecordId,
      firstValue(formData, "destinationOrganizationId"),
    );
  } catch (error) {
    const reason = encodeURIComponent(publicActionError(error));
    redirect(`${returnTo}?error=product-transfer&reason=${reason}`);
  }

  revalidateTransferredProductPaths(transfer);
  redirect(
    `/dashboard/${encodeURIComponent(transfer.destinationOrganizationId)}/products/${encodeURIComponent(transfer.product.productId)}?notice=product-transferred`,
  );
}

export async function movePrivateProductAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const sourceOrganizationId = firstValue(formData, "sourceOrganizationId");
  const productRecordId = firstValue(formData, "productRecordId");
  const productId = firstValue(formData, "productId");
  const destinationOrganizationId = firstValue(formData, "destinationOrganizationId");

  let move: Awaited<ReturnType<typeof movePrivateProductForOrganizationOwner>>;
  try {
    move = await movePrivateProductForOrganizationOwner(
      current.subject.subjectId,
      sourceOrganizationId,
      productRecordId,
      destinationOrganizationId,
    );
  } catch (error) {
    const recovery = await getProductMoveRecoveryState(
      current.subject.subjectId,
      productRecordId,
    ).catch(() => null);
    const returnOrganizationId = recovery?.organizationId ?? sourceOrganizationId;
    const returnProductId = recovery?.productId ?? productId;
    if (recovery?.organizationId === destinationOrganizationId && !recovery.pending) {
      redirect(
        `/dashboard/${encodeURIComponent(destinationOrganizationId)}/products/${encodeURIComponent(returnProductId)}?notice=product-moved`,
      );
    }
    const reason = encodeURIComponent(
      recovery?.pending
        ? "The product move was interrupted. Resume it from this page."
        : publicActionError(error),
    );
    redirect(
      `/dashboard/${encodeURIComponent(returnOrganizationId)}/products/${encodeURIComponent(returnProductId)}?error=product-move&reason=${reason}`,
    );
  }

  revalidateTransferredProductPaths(move);
  redirect(
    `/dashboard/${encodeURIComponent(move.destinationOrganizationId)}/products/${encodeURIComponent(move.product.productId)}?notice=product-moved`,
  );
}

export async function archiveOrganizationProductAction(formData: FormData): Promise<void> {
  await updateOrganizationProductArchivedStateAction(
    formData,
    archiveOrganizationProduct,
    "product-archived",
  );
}

export async function restoreOrganizationProductAction(formData: FormData): Promise<void> {
  await updateOrganizationProductArchivedStateAction(
    formData,
    restoreOrganizationProduct,
    "product-restored",
  );
}

export async function deleteOrganizationProductAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productRecordId = firstValue(formData, "productRecordId");
  let deletion: Awaited<ReturnType<typeof deleteOrganizationProduct>>;
  try {
    deletion = await deleteOrganizationProduct(
      current.subject.subjectId,
      organizationId,
      productRecordId,
      firstValue(formData, "confirmedRemoval") === "true",
    );
  } catch (error) {
    redirect(
      `/dashboard/${encodeURIComponent(organizationId)}/products?error=product-lifecycle&reason=${encodeURIComponent(publicActionError(error))}`,
    );
  }
  revalidateProductLifecyclePaths(deletion.affectedOrganizationIds, deletion.productId);
  redirect(
    `/dashboard/${encodeURIComponent(organizationId)}/products?notice=${deletion.removedSharedInstallation ? "shared-product-removed" : "product-deleted"}`,
  );
}

export async function setOrganizationProductVisibilityAction(formData: FormData): Promise<void> {
  const { current, organizationId, productRecordId, productId } =
    await organizationProductActionContext(formData);
  const visibilityValue = firstValue(formData, "visibility");
  const returnTo = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}`;
  if (visibilityValue !== "private" && visibilityValue !== "public") {
    redirect(`${returnTo}?error=product-visibility-invalid`);
  }
  let before: Awaited<ReturnType<typeof getProductShareInfo>>;
  try {
    before = await getProductShareInfo(current.subject.subjectId, organizationId, productRecordId);
    if (!before) throw new Error("Product availability is managed by its publishing organization.");
    await setOrganizationProductVisibility(
      current.subject.subjectId,
      organizationId,
      productRecordId,
      visibilityValue as ProductVisibility,
      firstValue(formData, "confirmedPrivateRemoval") === "true",
    );
  } catch (error) {
    const requiresConfirmation =
      error instanceof Error && error.message.startsWith("Confirm making this product private");
    redirect(
      requiresConfirmation
        ? `${returnTo}?error=product-private-confirmation`
        : `${returnTo}?error=product-visibility-update`,
    );
  }
  for (const affectedOrganization of [
    organizationId,
    ...before.adopterOrganizations.map((organization) => organization.organizationId),
  ]) {
    revalidatePath(`/dashboard/${affectedOrganization}/products`);
    revalidatePath(`/dashboard/${affectedOrganization}/products/${encodeURIComponent(productId)}`);
  }
  redirect(`${returnTo}?notice=product-visibility-updated`);
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
  let invitationId: string | null = null;
  try {
    const origin = browserOriginFromHeaders(await headers());
    const result = await createOrganizationInvitation(
      current.subject.subjectId,
      organizationId,
      firstValue(formData, "email"),
      "admin",
    );
    invitationId = result.invitation.invitationId;
    await sendOrganizationInvitationEmail(
      result.invitation.email,
      result.token,
      result.organizationName,
      result.invitation.role,
      { origin },
    );
  } catch (error) {
    if (invitationId) {
      try {
        await revokeOrganizationInvitation(current.subject.subjectId, organizationId, invitationId);
      } catch (cleanupError) {
        console.error("Could not revoke an organization invitation after email failure", {
          error:
            cleanupError instanceof Error ? cleanupError.message.slice(0, 240) : "Unknown error",
        });
      }
    }
    console.error("Organization invitation email failed", {
      error: error instanceof Error ? error.message.slice(0, 240) : "Unknown error",
    });
    const message = publicActionError(error);
    const code =
      message === "Email delivery is not configured. No email was sent."
        ? "mail-unconfigured"
        : "invite-failed";
    redirect(`/dashboard/${organizationId}/people?error=${code}`);
  }
  redirect(`/dashboard/${organizationId}/people?notice=invite-sent`);
}

export async function resendOrganizationInvitationAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const invitationId = firstValue(formData, "invitationId");
  const peoplePath = `/dashboard/${encodeURIComponent(organizationId)}/people`;
  if (!isMailDeliveryConfigured()) redirect(`${peoplePath}?error=mail-unconfigured`);

  let resentInvitationId: string | null = null;
  try {
    const origin = browserOriginFromHeaders(await headers());
    const result = await prepareOrganizationInvitationResend(
      current.subject.subjectId,
      organizationId,
      invitationId,
    );
    resentInvitationId = result.invitation.invitationId;
    await sendOrganizationInvitationEmail(
      result.invitation.email,
      result.token,
      result.organizationName,
      result.invitation.role,
      { origin },
    );
  } catch (error) {
    if (resentInvitationId) {
      try {
        await revokeOrganizationInvitation(
          current.subject.subjectId,
          organizationId,
          resentInvitationId,
        );
      } catch (cleanupError) {
        console.error("Could not revoke a resent organization invitation after email failure", {
          error:
            cleanupError instanceof Error ? cleanupError.message.slice(0, 240) : "Unknown error",
        });
      }
    }
    console.error("Organization invitation resend failed", {
      error: error instanceof Error ? error.message.slice(0, 240) : "Unknown error",
    });
    const message = publicActionError(error);
    const code =
      message === "Email delivery is not configured. No email was sent."
        ? "mail-unconfigured"
        : "resend-failed";
    redirect(`${peoplePath}?error=${code}`);
  }

  if (!resentInvitationId) redirect(`${peoplePath}?error=resend-failed`);
  try {
    await completeOrganizationInvitationResend(
      current.subject.subjectId,
      organizationId,
      invitationId,
      resentInvitationId,
    );
  } catch (error) {
    console.error("Could not replace an older organization invitation after resend", {
      error: error instanceof Error ? error.message.slice(0, 240) : "Unknown error",
    });
  }
  redirect(`${peoplePath}?notice=invite-resent`);
}

export async function inviteProductMemberAction(formData: FormData): Promise<void> {
  const { current, organizationId, productId, productPath } =
    await productPeopleActionContext(formData);
  if (!isMailDeliveryConfigured()) redirect(`${productPath}?error=mail-unconfigured`);
  const role = firstValue(formData, "role");
  if (role !== "admin" && role !== "member") redirect(`${productPath}?error=invite-failed`);
  let invitationId: string | null = null;
  try {
    const origin = browserOriginFromHeaders(await headers());
    const result = await createProductInvitation(
      current.subject.subjectId,
      organizationId,
      productId,
      firstValue(formData, "email"),
      role,
    );
    invitationId = result.invitation.invitationId;
    await sendProductInvitationEmail(
      result.invitation.email,
      result.token,
      result.productName,
      result.invitation.role,
      { origin },
    );
  } catch (error) {
    if (invitationId) {
      try {
        await revokeProductInvitation(
          current.subject.subjectId,
          organizationId,
          productId,
          invitationId,
        );
      } catch (cleanupError) {
        console.error("Could not revoke a product invitation after email failure", {
          error:
            cleanupError instanceof Error ? cleanupError.message.slice(0, 240) : "Unknown error",
        });
      }
    }
    console.error("Product invitation email failed", {
      error: error instanceof Error ? error.message.slice(0, 240) : "Unknown error",
    });
    const message = publicActionError(error);
    const code =
      message === "Email delivery is not configured. No email was sent."
        ? "mail-unconfigured"
        : "invite-failed";
    redirect(`${productPath}?error=${code}`);
  }
  redirect(`${productPath}?notice=invite-sent`);
}

export async function addExistingProductMemberAction(formData: FormData): Promise<void> {
  const { current, organizationId, productId, productPath } =
    await productPeopleActionContext(formData);
  let result: "added" | "updated" | "already-assigned";
  try {
    result = await addExistingProductMemberByEmail(
      current.subject.subjectId,
      organizationId,
      productId,
      firstValue(formData, "email"),
      firstValue(formData, "accessRoleId"),
      firstValue(formData, "membershipRole"),
    );
  } catch (error) {
    console.error("Existing product member access grant failed", {
      error: error instanceof Error ? error.message.slice(0, 240) : "Unknown error",
    });
    redirect(`${productPath}?error=existing-member-failed`);
  }
  revalidatePath(productPath);
  const notice =
    result === "added"
      ? "existing-member-added"
      : result === "updated"
        ? "existing-member-updated"
        : "existing-member-already-assigned";
  redirect(`${productPath}?notice=${notice}`);
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
  const { current, organizationId, productId, productPath } =
    await productPeopleActionContext(formData);
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
  await mutateProductPeopleRecord(
    formData,
    "subjectId",
    "member-remove",
    "member-removed",
    removeProductMember,
  );
}

export async function revokeProductInvitationAction(formData: FormData): Promise<void> {
  await mutateProductPeopleRecord(
    formData,
    "invitationId",
    "invite-revoke",
    "invite-revoked",
    revokeProductInvitation,
  );
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

export async function retireLegacyAccessAction(formData: FormData): Promise<void> {
  const { current, organizationId: operationsOrganizationId } =
    await requireOperationsAdministratorContext(formData);
  let retired: { grants: number; keys: number };
  try {
    retired = await retireLegacyAccess(current.subject.subjectId);
  } catch {
    redirect(
      operationsHref(
        "/dashboard/operations/legacy-access?error=migration",
        operationsOrganizationId,
      ),
    );
  }
  revalidatePath("/dashboard/operations/legacy-access");
  redirect(
    operationsHref(
      `/dashboard/operations/legacy-access?retired=${retired.grants},${retired.keys}`,
      operationsOrganizationId,
    ),
  );
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

function productAccessRoleUpdateError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "This permission set could not be saved. Check your access and try again.";
  }
  if (error.message === "An access role with that name already exists.") {
    return "A permission set with that name already exists. Choose another name.";
  }
  if (error.message === "Enter a role name up to 80 characters.") {
    return "Enter a permission set name with 1–80 characters.";
  }
  if (error.message === "The role description must be 240 characters or fewer.") {
    return "Keep the description within 240 characters.";
  }
  if (error.message === "Enter 1 to 32 valid action names.") return error.message;
  if (error.message === "Access role not found.") {
    return "This permission set is no longer available. Return to the list and reopen it.";
  }
  if (error.message === "You do not have permission to manage this product.") {
    return "You do not have permission to edit this permission set.";
  }
  if (error.message === "Organization is busy. Try again shortly.") return error.message;
  return "This permission set could not be saved. Check your access and try again.";
}

export async function updateProductAccessRoleAction(
  formData: FormData,
): Promise<ProductAccessRoleActionState> {
  const current = await getCurrentSession();
  if (!current) return { error: "Sign in again to update this permission set." };

  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const accessRoleId = firstValue(formData, "accessRoleId");
  try {
    await updateProductAccessRole(
      current.subject.subjectId,
      organizationId,
      productId,
      accessRoleId,
      {
        name: firstValue(formData, "roleName"),
        description: firstValue(formData, "roleDescription"),
        actions: firstValue(formData, "actions").split(/[\n,]/),
      },
    );
  } catch (error) {
    return { error: productAccessRoleUpdateError(error) };
  }

  const rolesPath = `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/roles`;
  const editPath = `${rolesPath}/${encodeURIComponent(accessRoleId)}/edit`;
  revalidatePath(rolesPath);
  revalidatePath(editPath);
  return { updated: true };
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

function productRoleCatalogPath(organizationId: string, productId: string) {
  return `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/roles/catalog`;
}

async function runProductRoleCatalogAction(
  formData: FormData,
  error: "role-catalog-fetch" | "role-catalog-apply",
  notice: "role-catalog-staged" | "role-catalog-applied",
  mutation: (subjectId: SubjectId, organizationId: string, productId: string) => Promise<unknown>,
  refreshAccess = false,
): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const catalogPath = productRoleCatalogPath(organizationId, productId);
  try {
    await mutation(current.subject.subjectId, organizationId, productId);
  } catch {
    redirect(`${catalogPath}?error=${error}`);
  }
  revalidatePath(catalogPath);
  const encodedProductPath = `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}`;
  revalidatePath(`${encodedProductPath}/roles`);
  if (refreshAccess) revalidatePath(`${encodedProductPath}/access`);
  redirect(`${catalogPath}?notice=${notice}`);
}

export async function fetchProductAccessRoleCatalogAction(formData: FormData): Promise<void> {
  await runProductRoleCatalogAction(
    formData,
    "role-catalog-fetch",
    "role-catalog-staged",
    stageProductAccessRoleCatalog,
  );
}

export async function applyProductAccessRoleCatalogAction(formData: FormData): Promise<void> {
  await runProductRoleCatalogAction(
    formData,
    "role-catalog-apply",
    "role-catalog-applied",
    applyProductAccessRoleCatalog,
    true,
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

export async function deletePermissionGrantAction(formData: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizationId = firstValue(formData, "organizationId");
  const productId = firstValue(formData, "productId");
  const accessPath = `/dashboard/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(
    productId,
  )}/access`;
  try {
    await deletePermissionGrant(current.subject.subjectId, firstValue(formData, "membershipId"));
  } catch {
    redirect(`${accessPath}?error=grant-delete-failed`);
  }
  redirect(`${accessPath}?notice=grant-deleted`);
}

export async function updateAccountStatusAction(formData: FormData): Promise<void> {
  const { current, organizationId: operationsOrganizationId } =
    await requireOperationsAdministratorContext(formData, "/dashboard?notice=admin-required");
  const status = firstValue(formData, "status");
  if (status !== "active" && status !== "disabled")
    redirect(
      operationsHref(
        "/dashboard/operations/accounts?error=account-update-failed",
        operationsOrganizationId,
      ),
    );
  try {
    await updateAccountStatus(current.subject.subjectId, firstValue(formData, "subjectId"), status);
  } catch {
    redirect(
      operationsHref(
        "/dashboard/operations/accounts?error=account-update-failed",
        operationsOrganizationId,
      ),
    );
  }
  revalidatePath("/dashboard/operations/accounts");
  redirect(
    operationsHref("/dashboard/operations/accounts?notice=account-updated", operationsOrganizationId),
  );
}

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const { current, organizationId: operationsOrganizationId } =
    await requireOperationsAdministratorContext(formData, "/dashboard?notice=admin-required");
  try {
    await deleteAccountForAdministrator(
      current.subject.subjectId,
      firstValue(formData, "subjectId"),
    );
  } catch (error) {
    const errorCode =
      error instanceof Error && error.message.startsWith("Transfer organization and product")
        ? "account-delete-owner"
        : "account-delete-failed";
    redirect(
      operationsHref(
        `/dashboard/operations/accounts?error=${errorCode}`,
        operationsOrganizationId,
      ),
    );
  }
  revalidatePath("/dashboard/operations/accounts");
  redirect(
    operationsHref("/dashboard/operations/accounts?notice=account-deleted", operationsOrganizationId),
  );
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
