import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
  revalidatePath: vi.fn(),
  getCurrentSession: vi.fn(),
  isAdministrator: vi.fn(),
  decideOrganizationRequest: vi.fn(),
  transferPublicProductForAdministrator: vi.fn(),
  retireLegacyAccess: vi.fn(),
  updateAccountStatus: vi.fn(),
  deleteAccountForAdministrator: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth/consumer-sso", () => ({ safeConsumerAuthorizationReturnTo: vi.fn() }));
vi.mock("@/lib/auth/mail", () => ({
  browserOriginFromHeaders: vi.fn(),
  isMailDeliveryConfigured: vi.fn(),
  sendOrganizationInvitationEmail: vi.fn(),
  sendProductInvitationEmail: vi.fn(),
  sendRecoveryEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
}));
vi.mock("@/lib/auth/coordination", () => ({
  consumePasswordRecoveryRateLimit: vi.fn(),
  consumeProductLookupRateLimit: vi.fn(),
  passwordRecoveryRequesterKey: vi.fn(),
}));
vi.mock("@/lib/auth/service", () => {
  const serviceFunctions = [
    "acceptOrganizationInvitation",
    "authenticate",
    "completeEmailAction",
    "createApiKeyForSubject",
    "createConsumerClient",
    "createOrganization",
    "createOrganizationInvitation",
    "createOrganizationProduct",
    "createPermissionGrant",
    "createProductAccessRole",
    "createProductInvitation",
    "createSession",
    "getOrganizationForSubject",
    "getProductShareInfo",
    "installPublicProduct",
    "issueEmailAction",
    "issueRecoveryAction",
    "registerAccount",
    "removeOrganizationMember",
    "removeProductAccessRole",
    "removeProductMember",
    "revokeApiKeyForSubject",
    "revokeConsumerClient",
    "revokeOrganizationInvitation",
    "revokeProductInvitation",
    "revokeSession",
    "rotateConsumerClient",
    "setOrganizationProductVisibility",
    "setSessionCookie",
    "signOutCurrentSession",
    "transferPublicProductForAdministrator",
    "updateAccountProfile",
    "updateAccountStatus",
    "updateGrantStatus",
    "updateOrganizationMemberRole",
    "updateOrganizationName",
    "updateOrganizationProduct",
    "updateProductMemberRole",
  ];
  const service = Object.fromEntries(serviceFunctions.map((name) => [name, vi.fn()]));
  return {
    ...service,
    getCurrentSession: mocks.getCurrentSession,
    isAdministrator: mocks.isAdministrator,
    decideOrganizationRequest: mocks.decideOrganizationRequest,
    deleteAccountForAdministrator: mocks.deleteAccountForAdministrator,
    retireLegacyAccess: mocks.retireLegacyAccess,
    transferPublicProductForAdministrator: mocks.transferPublicProductForAdministrator,
    updateAccountStatus: mocks.updateAccountStatus,
  };
});

import {
  deleteAccountAction,
  retireLegacyAccessAction,
  reviewOrganizationRequestAction,
  transferPublicProductAction,
  updateAccountStatusAction,
} from "@/app/actions";

const subjectId = "33333333-3333-4333-8333-333333333333";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

describe("platform admin action destinations", () => {
  beforeEach(() => {
    mocks.getCurrentSession.mockResolvedValue({ subject: { subjectId } });
    mocks.isAdministrator.mockReturnValue(true);
    mocks.decideOrganizationRequest.mockResolvedValue(undefined);
    mocks.transferPublicProductForAdministrator.mockResolvedValue({
      affectedOrganizationIds: [],
      product: { productId: "atlas" },
    });
    mocks.retireLegacyAccess.mockResolvedValue({ grants: 2, keys: 3 });
    mocks.updateAccountStatus.mockResolvedValue(undefined);
    mocks.deleteAccountForAdministrator.mockResolvedValue(undefined);
  });

  it("returns organization review success and errors to Organization requests", async () => {
    await expect(
      reviewOrganizationRequestAction(
        formData({ organizationId: "org-123", approvalStatus: "approved" }),
      ),
    ).rejects.toThrow(
      "redirect:/dashboard/operations/organization-requests?notice=organization-approved",
    );

    mocks.decideOrganizationRequest.mockRejectedValueOnce(new Error("already reviewed"));
    await expect(
      reviewOrganizationRequestAction(
        formData({ organizationId: "org-123", approvalStatus: "rejected" }),
      ),
    ).rejects.toThrow(
      "redirect:/dashboard/operations/organization-requests?error=organization-review",
    );
  });

  it("returns product transfer success and errors to Shared products", async () => {
    await expect(
      transferPublicProductAction(
        formData({ productRecordId: "record-1", destinationOrganizationId: "org-123" }),
      ),
    ).rejects.toThrow("redirect:/dashboard/operations/shared-products?notice=product-transferred");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/operations/shared-products");

    mocks.transferPublicProductForAdministrator.mockRejectedValueOnce(
      new Error("Only a public publisher product can be transferred."),
    );
    await expect(
      transferPublicProductAction(
        formData({ productRecordId: "record-1", destinationOrganizationId: "org-123" }),
      ),
    ).rejects.toThrow(
      "redirect:/dashboard/operations/shared-products?error=product-transfer&reason=Only%20a%20public%20publisher%20product%20can%20be%20transferred.",
    );
  });

  it("returns legacy access cleanup results and errors to Remove older access", async () => {
    await expect(retireLegacyAccessAction()).rejects.toThrow(
      "redirect:/dashboard/operations/legacy-access?retired=2,3",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/operations/legacy-access");

    mocks.retireLegacyAccess.mockRejectedValueOnce(new Error("storage failure"));
    await expect(retireLegacyAccessAction()).rejects.toThrow(
      "redirect:/dashboard/operations/legacy-access?error=migration",
    );
  });

  it("returns account status and deletion results and errors to Accounts", async () => {
    await expect(
      updateAccountStatusAction(formData({ subjectId: "account-1", status: "disabled" })),
    ).rejects.toThrow("redirect:/dashboard/operations/accounts?notice=account-updated");

    mocks.updateAccountStatus.mockRejectedValueOnce(new Error("storage failure"));
    await expect(
      updateAccountStatusAction(formData({ subjectId: "account-1", status: "disabled" })),
    ).rejects.toThrow("redirect:/dashboard/operations/accounts?error=account-update-failed");

    await expect(deleteAccountAction(formData({ subjectId: "account-1" }))).rejects.toThrow(
      "redirect:/dashboard/operations/accounts?notice=account-deleted",
    );

    mocks.deleteAccountForAdministrator.mockRejectedValueOnce(
      new Error("Transfer organization and product ownership first"),
    );
    await expect(deleteAccountAction(formData({ subjectId: "account-1" }))).rejects.toThrow(
      "redirect:/dashboard/operations/accounts?error=account-delete-owner",
    );
  });
});
