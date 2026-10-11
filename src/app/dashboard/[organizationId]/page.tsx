import { CopyOrganizationIdButton } from "@/components/copy-organization-id-button";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  OrganizationNextSteps,
  OrganizationOverviewMetrics,
  OrganizationProductsSection,
} from "@/components/organization-overview-sections";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listApiKeysForSubject,
  listOrganizationMembers,
  listOrganizationPermissionGrants,
  listProductsForOrganization,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function OrganizationOverview({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const organizationPromise = getOrganizationForSubject(current.subject.subjectId, organizationId);
  const membersPromise = organizationPromise.then((organization) =>
    organization.membership.role === "owner" || organization.membership.role === "admin"
      ? listOrganizationMembers(current.subject.subjectId, organizationId)
      : Promise.resolve([]),
  );
  const [organization, products, grants, keys, members] = await Promise.all([
    organizationPromise,
    listProductsForOrganization(current.subject.subjectId, organizationId),
    listOrganizationPermissionGrants(current.subject.subjectId, organizationId),
    listApiKeysForSubject(current.subject.subjectId),
    membersPromise,
  ]);
  const managers =
    organization.membership.role === "owner" || organization.membership.role === "admin";
  const orgKeys = keys.filter((key) => key.scope.organizationId === organizationId);
  // This request-rendered page must compare key expiry against the current time.
  const now =
    // eslint-disable-next-line react-hooks/purity
    Date.now();
  const activeKeys = orgKeys.filter(
    (key) => key.status === "active" && (!key.expiresAt || Date.parse(key.expiresAt) > now),
  );

  return (
    <>
      <DashboardHeading
        description={
          managers
            ? "Manage the organization catalog, then manage each product’s members and access inside that product."
            : "See the products and permissions assigned to you."
        }
      />
      <section
        className="dashboard-card organization-id-card"
        aria-labelledby="organization-id-title"
      >
        <div className="organization-id-heading">
          <h2 id="organization-id-title">Organization ID</h2>
          <p>Use this ID when configuring an app or integration.</p>
        </div>
        <CopyOrganizationIdButton organizationId={organizationId} />
      </section>
      {query.notice === "invitation-accepted" ? (
        <DashboardNotice
          message="You joined the product. Open Products to see your access."
          kind="success"
        />
      ) : null}
      <OrganizationOverviewMetrics
        activeKeyCount={activeKeys.length}
        grantCount={grants.length}
        managerCount={members.length}
        managers={managers}
        organizationId={organizationId}
        productCount={products.length}
      />
      <OrganizationProductsSection
        managers={managers}
        organizationId={organizationId}
        products={products}
      />
      <OrganizationNextSteps managers={managers} organizationId={organizationId} />
    </>
  );
}
