"use client";

import { useRouter } from "next/navigation";
import type { OrganizationSummary } from "@/lib/auth/service";

export function OrganizationSwitcher({
  organizations,
  organizationId,
}: {
  organizations: OrganizationSummary[];
  organizationId: string;
}) {
  const router = useRouter();
  return (
    <label className="org-switcher">
      <span>Organization</span>
      <select
        aria-label="Switch organization"
        value={organizationId}
        onChange={(event) => router.push(`/dashboard/${event.target.value}`)}
      >
        {organizations.map(({ organization }) => (
          <option key={organization.organizationId} value={organization.organizationId}>
            {organization.name}
          </option>
        ))}
      </select>
    </label>
  );
}
