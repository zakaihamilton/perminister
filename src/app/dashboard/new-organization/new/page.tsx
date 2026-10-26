import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import { OrganizationRequestPageShell } from "@/components/organization-request-page-shell";
import {
  NewOrganizationRequestNotices,
  OrganizationRequestSubmission,
} from "@/components/new-organization-sections";
import { getOrganizationRequestPageContext } from "@/lib/auth/organization-request-page-context";

export default async function NewOrganizationRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const context = await getOrganizationRequestPageContext(searchParams);
  const { current, requests, query } = context;

  return (
    <OrganizationRequestPageShell
      context={context}
      breadcrumbs={[
        { label: "Your organization requests", href: "/dashboard/new-organization" },
        { label: "Request an organization" },
      ]}
    >
      <>
        <DashboardHeading
          description="A platform administrator must approve each organization before you can use it."
          action={
            <Link className="button button-secondary" href="/dashboard/new-organization">
              Back to requests
            </Link>
          }
        />
        <NewOrganizationRequestNotices error={query.error} notice={query.notice} />
        <OrganizationRequestSubmission
          emailVerified={Boolean(current.subject.emailVerifiedAt)}
          hasPendingRequest={requests.some((request) => request.status === "pending")}
        />
      </>
    </OrganizationRequestPageShell>
  );
}
