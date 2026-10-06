"use client";

import { useRouter } from "next/navigation";
import type { OrganizationSummary } from "@/lib/auth/service";
import { CustomDropdown } from "@/components/custom-dropdown";

export function OrganizationSwitcher({
  organizations,
  organizationId,
}: {
  organizations: OrganizationSummary[];
  organizationId: string;
}) {
  const router = useRouter();
  return (
    <label className="org-switcher" htmlFor="organization-switcher">
      <span>Organization</span>
      <CustomDropdown
        aria-label="Switch organization"
        className="org-switcher-dropdown"
        id="organization-switcher"
        options={organizations.map(({ organization }) => ({
          value: organization.organizationId,
          label: organization.name,
        }))}
        value={organizationId}
        onValueChange={(nextOrganizationId) => router.push(`/dashboard/${nextOrganizationId}`)}
      />
    </label>
  );
}
