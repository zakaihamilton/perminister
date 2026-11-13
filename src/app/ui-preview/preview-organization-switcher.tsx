"use client";

import { useState } from "react";
import type { OrganizationSummary } from "@/lib/auth/service";
import { OrganizationSwitcher } from "@/components/organization-switcher";

export function PreviewOrganizationSwitcher({
  organizations,
  organizationId,
}: {
  organizations: OrganizationSummary[];
  organizationId: string;
}) {
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(organizationId);
  return (
    <OrganizationSwitcher
      organizations={organizations}
      organizationId={selectedOrganizationId}
      onOrganizationChange={setSelectedOrganizationId}
    />
  );
}
