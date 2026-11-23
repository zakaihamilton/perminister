import "server-only";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  deleteAccountForAdministrator,
  getCurrentSession,
  retireLegacyAccess,
  revokeSession,
  updateAccountProfile,
  updateAccountStatus,
} from "@/lib/auth/service";
import { operationsHref } from "@/lib/operations-navigation";
import {
  dashboardReturnTo,
  firstValue,
  requireOperationsAdministratorContext,
} from "./shared";

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
