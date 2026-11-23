import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createOrganization,
  decideOrganizationRequest,
  getCurrentSession,
  updateOrganizationName,
} from "@/lib/auth/service";
import { operationsHref } from "@/lib/operations-navigation";
import {
  dashboardReturnTo,
  firstValue,
  requireOperationsAdministratorContext,
} from "./shared";

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
