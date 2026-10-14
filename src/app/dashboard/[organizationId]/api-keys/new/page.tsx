import Link from "next/link";
import { ApiKeyNotices } from "@/components/api-key-item";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { OrganizationApiKeyCreationSection } from "@/components/organization-api-key-sections";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listOrganizationPermissionGrants,
  listProductsForOrganization,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function NewOrganizationApiKeyPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const { organizationId } = await params;
  await getOrganizationForSubject(current.subject.subjectId, organizationId);
  const [products, grants] = await Promise.all([
    listProductsForOrganization(current.subject.subjectId, organizationId),
    listOrganizationPermissionGrants(current.subject.subjectId, organizationId),
  ]);
  const allowedProductIds = new Set(
    grants
      .filter((grant) => grant.subjectId === current.subject.subjectId && grant.status === "active")
      .map((grant) => grant.scope.productId),
  );
  const allowedProducts = products.filter((product) => allowedProductIds.has(product.productId));
  const canCreate = !!current.subject.emailVerifiedAt && allowedProducts.length > 0;
  const returnTo = `/dashboard/${organizationId}/api-keys`;
  const unavailableMessage = !current.subject.emailVerifiedAt
    ? null
    : products.length === 0
      ? "Add a product before creating an API key."
      : "You need active permission for a product before creating an API key.";

  return (
    <>
      <DashboardHeading
        description="Choose a product, define the key’s actions, and limit where it can be used."
        action={
          <Link className="button button-secondary" href={returnTo}>
            Back to API keys
          </Link>
        }
      />
      <ApiKeyNotices isEmailVerified={!!current.subject.emailVerifiedAt} />
      {canCreate ? (
        <OrganizationApiKeyCreationSection
          canCreate
          organizationId={organizationId}
          products={allowedProducts}
          returnTo={returnTo}
        />
      ) : unavailableMessage ? (
        <DashboardNotice message={unavailableMessage} />
      ) : null}
      {canCreate ? (
        <p className="role-help">
          The full key appears once after creation. Copy it into your server’s secret store.
        </p>
      ) : null}
    </>
  );
}
