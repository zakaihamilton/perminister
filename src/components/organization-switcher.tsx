"use client";

import { useRouter } from "next/navigation";
import type { OrganizationSummary } from "@/lib/auth/service";
import { CustomDropdown } from "@/components/custom-dropdown";

const requestOrganizationValue = "__request-organization__";

export function OrganizationSwitcher({
  organizations,
  organizationId,
}: {
  organizations: OrganizationSummary[];
  organizationId: string;
}) {
  const router = useRouter();
  const options = [
    ...organizations.map(({ organization }) => ({
      value: organization.organizationId,
      label: organization.name,
    })),
    { value: requestOrganizationValue, label: "Request organization", variant: "action" as const },
  ];

  return (
    <label className="org-switcher" htmlFor="organization-switcher">
      <span>Organization</span>
      <CustomDropdown
        aria-label="Choose an organization or request one"
        className="org-switcher-dropdown"
        id="organization-switcher"
        options={options}
        value={organizationId}
        onValueChange={(nextOrganizationId) => {
          if (nextOrganizationId === requestOrganizationValue) {
            router.push("/dashboard/new-organization");
            return;
          }
          router.push(`/dashboard/${nextOrganizationId}`);
        }}
      />
    </label>
  );
}
