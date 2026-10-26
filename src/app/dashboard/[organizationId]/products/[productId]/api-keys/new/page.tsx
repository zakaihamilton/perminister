import Link from "next/link";
import { ProductApiKeyPageNavigation } from "@/components/api-key-item";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductApiKeyCreationSection } from "@/components/product-api-key-sections";
import {
  getProductPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import { listOrganizationPermissionGrants } from "@/lib/auth/service";

export default async function NewProductApiKeyPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ current, organizationId, productId, access }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  const grants = await listOrganizationPermissionGrants(current.subject.subjectId, organizationId);
  const ownActiveGrant = grants.some(
    (grant) =>
      grant.subjectId === current.subject.subjectId &&
      grant.scope.productId === productId &&
      grant.status === "active",
  );
  const canCreate = !!current.subject.emailVerifiedAt && ownActiveGrant;
  const returnTo = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/api-keys`;
  const canManageAccess =
    access.membership?.role === "owner" || access.membership?.role === "admin";

  return (
    <>
      <DashboardHeading
        description="Choose what this key can do and where it can be used."
        action={
          <Link className="button button-secondary" href={returnTo}>
            Back to API keys
          </Link>
        }
      />
      <ProductApiKeyPageNavigation
        access={access}
        organizationId={organizationId}
        productId={productId}
        notice={query.notice}
        error={query.error}
        isEmailVerified={!!current.subject.emailVerifiedAt}
      />
      <ProductApiKeyCreationSection
        canCreate={canCreate}
        canManageAccess={canManageAccess}
        isEmailVerified={!!current.subject.emailVerifiedAt}
        organizationId={organizationId}
        product={access.product}
        productId={productId}
        returnTo={returnTo}
      />
      {canCreate ? (
        <p className="role-help">
          The full key appears once after creation. Copy it into your server’s secret store.
        </p>
      ) : null}
    </>
  );
}
