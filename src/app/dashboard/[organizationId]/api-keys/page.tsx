import Link from "next/link";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ApiKeyNotices } from "@/components/api-key-item";
import {
  ApiKeyAccessHint,
  OrganizationApiKeyRecords,
  OrganizationProductKeyLinks,
} from "@/components/organization-api-key-sections";
import {
  getCurrentSession,
  getOrganizationForSubject,
  listApiKeysForSubject,
  listOrganizationPermissionGrants,
  listProductsForOrganization,
} from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ApiKeysPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  await getOrganizationForSubject(current.subject.subjectId, organizationId);
  const [allKeys, products, grants] = await Promise.all([
    listApiKeysForSubject(current.subject.subjectId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
    listOrganizationPermissionGrants(current.subject.subjectId, organizationId),
  ]);
  const keys = allKeys.filter((key) => key.scope.organizationId === organizationId);
  const productNames = new Map(products.map((product) => [product.productId, product.name]));
  const ownActiveGrants = grants.filter(
    (grant) => grant.subjectId === current.subject.subjectId && grant.status === "active",
  );
  const allowedProductIds = new Set(ownActiveGrants.map((grant) => grant.scope.productId));
  const allowedProducts = products.filter((product) => allowedProductIds.has(product.productId));
  const canCreate = !!current.subject.emailVerifiedAt && allowedProducts.length > 0;
  const returnTo = `/dashboard/${organizationId}/api-keys`;

  // This request-rendered page must compare key expiry against the current time.
  const now =
    // eslint-disable-next-line react-hooks/purity
    Date.now();

  return (
    <>
      <DashboardHeading
        description="Review this organization’s API keys or create one for a product you can access."
        action={
          canCreate ? (
            <Link className="button button-primary" href={`${returnTo}/new`}>
              Create API key
            </Link>
          ) : null
        }
      />
      <ApiKeyNotices
        error={query.error}
        isEmailVerified={!!current.subject.emailVerifiedAt}
        notice={query.notice}
      />

      <OrganizationApiKeyRecords
        keys={keys}
        now={now}
        organizationId={organizationId}
        productNames={productNames}
        returnTo={returnTo}
      />
      <OrganizationProductKeyLinks organizationId={organizationId} products={products} />
      <ApiKeyAccessHint
        canCreate={canCreate}
        hasProducts={products.length > 0}
        isEmailVerified={!!current.subject.emailVerifiedAt}
      />
    </>
  );
}
