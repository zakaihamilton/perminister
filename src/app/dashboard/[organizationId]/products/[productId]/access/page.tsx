import {
  AccessGrantCreationSection,
  AccessGrantExplainer,
  ProductAccessGrantCard,
} from "@/components/product-access-sections";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import Link from "next/link";
import { listProductMembers, listProductPermissionGrants } from "@/lib/auth/service";
import {
  getProductPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import { redirect } from "next/navigation";

export default async function ProductAccessPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [context, query] = await Promise.all([getProductPageContext(params), searchParams]);
  const { current, organizationId, productId, access } = context;
  const role = access.membership?.role;
  if (!role) redirect(`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}`);
  const canManage = role === "owner" || role === "admin";
  const [grants, members] = await Promise.all([
    listProductPermissionGrants(current.subject.subjectId, organizationId, productId),
    canManage
      ? listProductMembers(current.subject.subjectId, organizationId, productId)
      : Promise.resolve([]),
  ]);
  const emailBySubject = new Map(
    members.map((member) => [member.membership.subjectId, member.email]),
  );
  if (!canManage) emailBySubject.set(current.subject.subjectId, current.subject.primaryEmail);
  const eligibleMembers = members.filter(
    (member) => member.emailVerified && member.membership.status === "active",
  );
  const accessRoles = access.product.accessRoles ?? [];

  return (
    <>
      <DashboardHeading
        description={
          canManage
            ? "Choose what product members can do and which resources it applies to."
            : "Review the app permissions assigned to you and where they apply."
        }
        action={
          canManage ? (
            <Link
              className="button button-secondary"
              href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/roles`}
            >
              Access roles
            </Link>
          ) : null
        }
      />
      {query.notice === "grant-created" ? (
        <DashboardNotice message="Access grant created." kind="success" />
      ) : null}
      {query.notice === "grant-updated" ? (
        <DashboardNotice message="Access grant updated." kind="success" />
      ) : null}
      {query.error === "grant-failed" ? (
        <DashboardNotice
          message="That access grant could not be created. Check the member and resource ID, or confirm the selected role is still configured."
          kind="error"
        />
      ) : null}

      <AccessGrantExplainer />

      {grants.length ? (
        <div className="access-grant-list">
          {grants.map((grant) => (
            <ProductAccessGrantCard
              key={grant.membershipId}
              grant={grant}
              email={
                emailBySubject.get(grant.subjectId) ??
                (grant.subjectId === current.subject.subjectId
                  ? current.subject.primaryEmail
                  : null)
              }
              canManage={canManage}
              organizationId={organizationId}
              productId={productId}
            />
          ))}
        </div>
      ) : (
        <section className="dashboard-empty-card">
          <div>
            <h2>No access grants yet</h2>
            <p>
              {canManage
                ? "Add access when a member needs to use app features."
                : "A product Owner or Admin can assign app permissions to you."}
            </p>
          </div>
        </section>
      )}

      {canManage ? (
        <AccessGrantCreationSection
          eligibleMembers={eligibleMembers}
          organizationId={organizationId}
          productId={productId}
          accessRoles={accessRoles}
        />
      ) : null}
    </>
  );
}
