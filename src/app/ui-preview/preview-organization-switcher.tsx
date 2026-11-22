"use client";

import { useState } from "react";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import type { OrganizationSummary } from "@/lib/auth/service";

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
      preview
      onOrganizationChange={setSelectedOrganizationId}
    />
  );
}
