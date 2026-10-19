import {
  acceptOrganizationInvitationAction,
  addPublicProductAction,
  createApiKeyAction,
  createGrantAction,
  createOrganizationAction,
  createOrganizationProductAction,
  createOrRotateConsumerClientAction,
  createProductAccessRoleAction,
  deletePermissionGrantAction,
  deleteAccountAction,
  inviteOrganizationMemberAction,
  inviteProductMemberAction,
  lookupProductWebsiteAction,
  registerAction,
  removeOrganizationMemberAction,
  removeProductAccessRoleAction,
  removeProductMemberAction,
  requestPasswordRecoveryAction,
  requestVerificationAction,
  resetPasswordAction,
  retireLegacyAccessAction,
  reviewOrganizationRequestAction,
  revokeApiKeyAction,
  revokeConsumerClientAction,
  revokeOrganizationInvitationAction,
  revokeProductInvitationAction,
  resendOrganizationInvitationAction,
  revokeSessionAction,
  setOrganizationProductVisibilityAction,
  transferOwnedPublicProductAction,
  transferPublicProductAction,
  updateAccountProfileAction,
  updateAccountStatusAction,
  updateGrantStatusAction,
  updateOrganizationMemberRoleAction,
  updateOrganizationNameAction,
  updateOrganizationProductAction,
  updateConsumerClientAction,
  updateProductMemberRoleAction,
  verifyEmailAction,
  type CreateApiKeyState,
  type ConsumerClientActionState,
  type ProductLookupState,
} from "@/app/actions";
import {
  approveConsumerAuthorizationAction,
  cancelConsumerAuthorizationAction,
} from "@/app/oauth/authorize/action";
import { isSameOriginBrowserRequest, publicRedirectResponse } from "@/lib/auth/http";

export const runtime = "nodejs";

type ActionResult = void | CreateApiKeyState | ConsumerClientActionState | ProductLookupState;
type StableAction = (formData: FormData) => Promise<ActionResult>;

const actions: Record<string, StableAction> = {
  acceptOrganizationInvitationAction,
  addPublicProductAction,
  approveConsumerAuthorizationAction,
  cancelConsumerAuthorizationAction,
  createApiKeyAction: (formData) => createApiKeyAction({}, formData),
  createGrantAction,
  createOrganizationAction,
  createOrganizationProductAction,
  createOrRotateConsumerClientAction: (formData) =>
    createOrRotateConsumerClientAction({}, formData),
  updateConsumerClientAction: (formData) => updateConsumerClientAction({}, formData),
  createProductAccessRoleAction,
  deletePermissionGrantAction,
  deleteAccountAction,
  inviteOrganizationMemberAction,
  inviteProductMemberAction,
  lookupProductWebsiteAction: (formData) => lookupProductWebsiteAction({}, formData),
  registerAction,
  removeOrganizationMemberAction,
  removeProductAccessRoleAction,
  removeProductMemberAction,
  requestPasswordRecoveryAction,
  requestVerificationAction,
  resetPasswordAction,
  retireLegacyAccessAction,
  reviewOrganizationRequestAction,
  revokeApiKeyAction,
  revokeConsumerClientAction,
  revokeOrganizationInvitationAction,
  revokeProductInvitationAction,
  resendOrganizationInvitationAction,
  revokeSessionAction,
  setOrganizationProductVisibilityAction,
  transferProductAction: (formData) =>
    formData.has("sourceOrganizationId")
      ? transferOwnedPublicProductAction(formData)
      : transferPublicProductAction(formData),
  updateAccountProfileAction,
  updateAccountStatusAction,
  updateGrantStatusAction,
  updateOrganizationMemberRoleAction,
  updateOrganizationNameAction,
  updateOrganizationProductAction,
  updateProductMemberRoleAction,
  verifyEmailAction,
};

const noStoreHeaders = { "Cache-Control": "no-store" };

function redirectLocation(error: unknown): string | null {
  if (!(error instanceof Error) || !("digest" in error)) return null;
  const digest = (error as Error & { digest?: unknown }).digest;
  if (typeof digest !== "string") return null;
  const parts = digest.split(";");
  if (parts[0] !== "NEXT_REDIRECT" || parts.length < 5) return null;
  return parts.slice(2, -2).join(";") || null;
}

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  if (!isSameOriginBrowserRequest(request)) {
    return publicRedirectResponse(request, "/login?error=request");
  }

  const { name } = await context.params;
  const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
  if (!action) {
    return Response.json({ error: "Unknown action." }, { status: 404, headers: noStoreHeaders });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "Invalid form submission." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  try {
    const result = await action(formData);
    if (result !== undefined) {
      return Response.json(result, { headers: noStoreHeaders });
    }
    return Response.json(
      { error: "The request did not complete. Reload the page and try again." },
      { status: 500, headers: noStoreHeaders },
    );
  } catch (error) {
    const location = redirectLocation(error);
    if (location) return publicRedirectResponse(request, location);
    console.error("Stable form action failed", { action: name });
    return Response.json(
      { error: "Perminister could not complete that request. Please try again." },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
