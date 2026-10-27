import { notFound } from "next/navigation";
import { DashboardHeading } from "@/components/dashboard-shell";
import { OrganizationRequestHistory } from "@/components/new-organization-sections";
import { OrganizationRequestEmptyShell } from "@/components/organization-request-page-shell";
import { PreviewGuard } from "../preview-guard";

export default function RequestShellPreview() {
  if (process.env.NODE_ENV !== "development" || process.env.PERMINISTER_UI_PREVIEW !== "1")
    notFound();
  return (
    <PreviewGuard>
      <OrganizationRequestEmptyShell breadcrumbs={[{ label: "Your organization requests" }]}>
        <div className="ui-preview-toolbar">
          <strong>UI preview · synthetic data</strong>
          <p>
            <a href="/ui-preview">Back to preview screens</a>
          </p>
          <p>Submissions and navigation outside the preview are disabled.</p>
        </div>
        <DashboardHeading description="Track existing requests or start a request for a new organization." />
        <OrganizationRequestHistory requests={[]} />
      </OrganizationRequestEmptyShell>
    </PreviewGuard>
  );
}
