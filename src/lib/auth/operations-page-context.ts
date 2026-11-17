import "server-only";

import { redirect } from "next/navigation";
import {
  getCurrentSession,
  isAdministrator,
  listOrganizationsForSubject,
} from "@/lib/auth/service";

export async function getOperationsPageContext(requestedOrganizationId?: string | string[]) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");

  const organizations =
    (await listOrganizationsForSubject?.(current.subject.subjectId)) ?? [];
  const selectedOrganization =
    (typeof requestedOrganizationId === "string"
      ? organizations.find(
          ({ organization }) => organization.organizationId === requestedOrganizationId,
        )
      : undefined) ??
    organizations[0] ??
    null;

  return {
    current,
    organizations,
    selectedOrganization,
    organizationId: selectedOrganization?.organization.organizationId,
  };
}

export type OperationsPageContext = Awaited<ReturnType<typeof getOperationsPageContext>>;
