"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ContextSwitcher } from "panel-frame-ui";
import type { OrganizationSummary } from "@/lib/auth/service";
import { operationsHref } from "@/lib/operations-navigation";

const requestOrganizationValue = "__request-organization__";

export function OrganizationSwitcher({
  organizations,
  organizationId,
  preview = false,
  onOrganizationChange,
  keepOperationsContext = false,
}: {
  organizations: OrganizationSummary[];
  organizationId: string;
  preview?: boolean;
  onOrganizationChange?: (organizationId: string) => void;
  keepOperationsContext?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const options = [
    ...organizations.map(({ organization }) => ({
      value: organization.organizationId,
      label: organization.name,
      description: "Organization access",
    })),
    {
      value: requestOrganizationValue,
      label: "Request organization",
      kind: "action" as const,
    },
  ];

  function selectOrganization(nextOrganizationId: string) {
    if (preview) {
      if (organizations.some(({ organization }) => organization.organizationId === nextOrganizationId))
        onOrganizationChange?.(nextOrganizationId);
      return;
    }
    if (nextOrganizationId === requestOrganizationValue) {
      router.push("/dashboard/new-organization");
      return;
    }
    if (nextOrganizationId === organizationId) return;
    const selectedOrganization = organizations.find(
      ({ organization }) => organization.organizationId === nextOrganizationId,
    );
    if (!selectedOrganization) {
      setError("Choose an organization you have access to.");
      return;
    }
    setError(null);
    router.push(
      keepOperationsContext
        ? operationsHref("/dashboard/operations", selectedOrganization.organization.organizationId)
        : `/dashboard/${encodeURIComponent(selectedOrganization.organization.organizationId)}`,
    );
  }

  if (!organizations.some(({ organization }) => organization.organizationId === organizationId)) {
    return (
      <div className="org-switcher">
        <span>Organization</span>
        <div className="pf-context-empty">
          No organization access
        </div>
      </div>
    );
  }

  return (
    <div className="org-switcher">
      <span>Organization</span>
      <ContextSwitcher
        aria-label="Choose an organization or request one"
        className="org-switcher-dropdown"
        footer={
          <Link className="pf-select-footer-link" href="/organizations">
            Organization access
          </Link>
        }
        id="organization-switcher"
        label="Organization"
        onValueChange={(value) => void selectOrganization(value)}
        options={options}
        value={organizationId}
      />
      {error ? (
        <span className="org-switcher-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
