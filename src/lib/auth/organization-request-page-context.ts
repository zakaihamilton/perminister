import "server-only";

import { redirect } from "next/navigation";
import {
  countPendingOrganizationsForAdministrator,
  getCurrentSession,
  isAdministrator,
  listOrganizationRequestsForSubject,
  listOrganizationsForSubject,
} from "@/lib/auth/service";

export type OrganizationRequestSearchParams = { error?: string; notice?: string };

export async function getOrganizationRequestPageContext(
  searchParams: Promise<OrganizationRequestSearchParams>,
) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const isPlatformAdministrator = isAdministrator(current.subject);
  const [organizations, requests, query, pendingOrganizationRequestCount] = await Promise.all([
    listOrganizationsForSubject(current.subject.subjectId),
    listOrganizationRequestsForSubject(current.subject.subjectId),
    searchParams,
    isPlatformAdministrator
      ? countPendingOrganizationsForAdministrator(current.subject.subjectId).catch(() => null)
      : null,
  ]);

  return {
    current,
    isPlatformAdministrator,
    organizations,
    requests,
    query,
    pendingOrganizationRequestCount,
  };
}

export type OrganizationRequestPageContext = Awaited<
  ReturnType<typeof getOrganizationRequestPageContext>
>;
