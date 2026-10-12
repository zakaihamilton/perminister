import Link from "next/link";
import { ApiKeyNotices } from "@/components/api-key-item";
import { DashboardHeading } from "@/components/dashboard-shell";
import {
  ProductApiKeyCreationSection,
  ProductApiKeyRecords,
} from "@/components/product-api-key-sections";
import { ProductNavigation } from "@/components/product-navigation";
import {
  getProductPageContext,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";
import { listApiKeysForSubject, listOrganizationPermissionGrants } from "@/lib/auth/service";

export default async function ProductApiKeysPage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ current, organizationId, productId, access }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  const [allKeys, grants] = await Promise.all([
    listApiKeysForSubject(current.subject.subjectId),
    listOrganizationPermissionGrants(current.subject.subjectId, organizationId),
  ]);
  // This request-rendered page compares key expiry against the current time.
  const now =
    // eslint-disable-next-line react-hooks/purity
    Date.now();
  const keys = allKeys.filter(
    (key) => key.scope.organizationId === organizationId && key.scope.productId === productId,
  );
  const ownActiveGrants = grants.filter(
    (grant) =>
      grant.subjectId === current.subject.subjectId &&
      grant.scope.productId === productId &&
      grant.status === "active",
  );
  const canCreate = !!current.subject.emailVerifiedAt && ownActiveGrants.length > 0;
  const returnTo = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/api-keys`;
  const canManageAccess =
    access.membership?.role === "owner" || access.membership?.role === "admin";

  return (
    <>
      <DashboardHeading
        description="Create and manage API keys that work with this product."
        action={
          <div className="product-detail-actions">
            {canCreate ? (
              <Link className="button button-primary" href="#create-api-key">
                Create API key
              </Link>
            ) : (
              <button className="button button-primary" disabled type="button">
                Create API key
              </button>
            )}
          </div>
        }
      />
      <ProductNavigation
        isSharedInstallation={Boolean(access.product.sharedProductRef)}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        role={access.membership?.role}
      />
      <ApiKeyNotices
        notice={query.notice}
        error={query.error}
        isEmailVerified={!!current.subject.emailVerifiedAt}
      />

      <ProductApiKeyRecords
        canCreate={canCreate}
        keys={keys}
        now={now}
        organizationId={organizationId}
        product={access.product}
        returnTo={returnTo}
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
      <p className="role-help">
        The full key appears once after creation. Copy it into your server’s secret store.
      </p>
    </>
  );
}
