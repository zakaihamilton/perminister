import { redirect } from "next/navigation";
import { getCurrentSession, listOrganizationsForSubject } from "@/lib/auth/service";
import { getLastSelectedOrganizationId } from "@/lib/auth/organization-preference";

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [organizations, query, lastSelectedOrganizationId] = await Promise.all([
    listOrganizationsForSubject(current.subject.subjectId),
    searchParams,
    getLastSelectedOrganizationId(),
  ]);

  if (organizations.length) {
    const selectedOrganization = organizations.find(
      ({ organization }) => organization.organizationId === lastSelectedOrganizationId,
    );
    redirect(
      `/dashboard/${encodeURIComponent(
        selectedOrganization?.organization.organizationId ??
          organizations[0].organization.organizationId,
      )}`,
    );
  }

  const parameters = new URLSearchParams();
  if (query.error) parameters.set("error", query.error);
  if (query.notice) parameters.set("notice", query.notice);
  const suffix = parameters.toString();
  redirect(`/dashboard/new-organization${suffix ? `?${suffix}` : ""}`);
}
