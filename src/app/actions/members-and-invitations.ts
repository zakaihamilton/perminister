import "server-only";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SubjectId } from "@/lib/auth/domain";
import {
  browserOriginFromHeaders,
  isMailDeliveryConfigured,
  sendOrganizationInvitationEmail,
  sendProductInvitationEmail,
} from "@/lib/auth/mail";
import {
  acceptOrganizationInvitation,
  addExistingProductMemberByEmail,
  completeOrganizationInvitationResend,
  createOrganizationInvitation,
  createProductInvitation,
  getCurrentSession,
  prepareOrganizationInvitationResend,
  removeOrganizationMember,
  removeProductMember,
  revokeOrganizationInvitation,
  revokeProductInvitation,
  updateOrganizationMemberRole,
  updateProductMemberRole,
} from "@/lib/auth/service";
import { firstValue, publicActionError } from "./shared";

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
