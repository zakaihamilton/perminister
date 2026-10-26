import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import { OrganizationRequestPageShell } from "@/components/organization-request-page-shell";
import {
  DashboardOnboardingNotices,
  OrganizationSetupStep,
} from "@/components/dashboard-onboarding-sections";
import { OrganizationRequestHistory } from "@/components/new-organization-sections";
import { getOrganizationRequestPageContext } from "@/lib/auth/organization-request-page-context";

export default async function OrganizationRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const context = await getOrganizationRequestPageContext(searchParams);
  const { current, requests, query } = context;
  const pendingRequest = requests.find((request) => request.status === "pending");
  const verified = Boolean(current.subject.emailVerifiedAt);

  return (
    <OrganizationRequestPageShell
      context={context}
      breadcrumbs={[{ label: "Your organization requests" }]}
    >
      <>
        <DashboardHeading
          description="Track existing requests or start a request for a new organization."
          action={
            verified && !pendingRequest ? (
              <Link className="button button-primary" href="/dashboard/new-organization/new">
                Request an organization
              </Link>
            ) : null
          }
        />
        <DashboardOnboardingNotices
          email={current.subject.primaryEmail}
          error={query.error}
          notice={query.notice}
        />
        <OrganizationSetupStep verified={verified} />
        <OrganizationRequestHistory requests={requests} />
        {context.organizations.length === 0 ? (
          <div className="onboarding-secondary">
            <span>Joining an existing team?</span>
            <Link href="/accept-invitation">Open an invitation</Link>
          </div>
        ) : null}
      </>
    </OrganizationRequestPageShell>
  );
}
