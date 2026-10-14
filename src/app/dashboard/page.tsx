import { getCurrentSession, listOrganizationsForSubject } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [organizations, query] = await Promise.all([
    listOrganizationsForSubject(current.subject.subjectId),
    searchParams,
  ]);

  if (organizations.length) {
    redirect(`/dashboard/${organizations[0].organization.organizationId}`);
  }

  const parameters = new URLSearchParams();
  if (query.error) parameters.set("error", query.error);
  if (query.notice) parameters.set("notice", query.notice);
  const suffix = parameters.toString();
  redirect(`/dashboard/new-organization${suffix ? `?${suffix}` : ""}`);
}
