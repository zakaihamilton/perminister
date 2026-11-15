import { notFound } from "next/navigation";
import { isUiPreviewAllowed } from "@/lib/ui-preview-access";
import { DashboardHeading } from "@/components/dashboard-shell";
import { OrganizationRequestHistory } from "@/components/new-organization-sections";
import { OrganizationRequestEmptyShell } from "@/components/organization-request-page-shell";
import type { OrganizationRequestSummary } from "@/lib/auth/service";
import { PreviewDropdown, PreviewToolbar } from "ui-preview-kit";
import { PreviewGuard } from "../preview-guard";

const pendingRequest: OrganizationRequestSummary = {
  organization: {
    kind: "organization",
    schemaVersion: 1,
    organizationId: "preview-requested-organization" as OrganizationRequestSummary["organization"]["organizationId"],
    name: "Example Studio",
    approvalStatus: "pending",
    createdBySubjectId: "preview-alex" as OrganizationRequestSummary["organization"]["createdBySubjectId"],
    createdAt: "2026-10-20T09:00:00Z",
    updatedAt: "2026-10-20T09:00:00Z",
  },
  status: "pending",
};

export default async function RequestShellPreview({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  if (!isUiPreviewAllowed()) notFound();
  const params = await searchParams;
  const scenario = params.scenario === "pending" ? "pending" : "empty";
  return (
    <PreviewGuard>
      <OrganizationRequestEmptyShell breadcrumbs={[{ label: "Your organization requests" }]}>
        <PreviewToolbar
          subtitle="Synthetic data · no organizations in the sidebar"
          note="Request submission is blocked. This route uses the authenticated dashboard shell with no selected organization."
          utilities={<a href="/ui-preview">Back to preview screens</a>}
        >
          <PreviewDropdown
            label="Scenario"
            value={scenario}
            options={[
              { value: "empty", label: "No requests", href: "/ui-preview/request?scenario=empty" },
              {
                value: "pending",
                label: "Request pending",
                href: "/ui-preview/request?scenario=pending",
              },
            ]}
          />
        </PreviewToolbar>
        <DashboardHeading description="Track existing requests or start a request for a new organization." />
        <OrganizationRequestHistory requests={scenario === "pending" ? [pendingRequest] : []} />
      </OrganizationRequestEmptyShell>
    </PreviewGuard>
  );
}
