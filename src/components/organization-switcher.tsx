"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ContextSwitcher } from "panel-frame-ui";
import type { OrganizationSummary } from "@/lib/auth/service";

const requestOrganizationValue = "__request-organization__";

export function OrganizationSwitcher({
  organizations,
  organizationId,
  preview = false,
}: {
  organizations: OrganizationSummary[];
  organizationId: string;
  preview?: boolean;
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

  async function selectOrganization(nextOrganizationId: string) {
    if (preview) return;
    if (nextOrganizationId === requestOrganizationValue) {
      router.push("/dashboard/new-organization");
      return;
    }
    if (nextOrganizationId === organizationId) return;

    setError(null);
    try {
      const response = await fetch("/api/organizations/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: nextOrganizationId }),
      });
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "The organization could not be selected.";
        setError(message);
        return;
      }
      router.push("/overview");
    } catch {
      setError("The organization could not be selected. Try again.");
    }
  }

  if (!organizations.some(({ organization }) => organization.organizationId === organizationId)) {
    return (
      <div className="org-switcher">
        <span>Organization</span>
        <div aria-label="No organization access" className="pf-context-empty">
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
