import Link from "next/link";
import Image from "next/image";
import { ProductIcon } from "@/components/product-icon";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
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
      {query.notice === "invitation-accepted" ? (
        <DashboardNotice
          message="You joined the product. Open Products to see your access."
          kind="success"
        />
      ) : null}
      <section className="dashboard-metric-grid" aria-label="Workspace summary">
        <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/products`}>
          <span>{managers ? "Products" : "Your products"}</span>
          <strong>{products.length}</strong>
          <small>{managers ? "View product catalog" : "View assigned products"}</small>
        </Link>
        <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/products`}>
          <span>{managers ? "Access grants" : "Your grants"}</span>
          <strong>{grants.length}</strong>
          <small>Open a product to review permissions</small>
        </Link>
        <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/api-keys`}>
          <span>Your API keys</span>
          <strong>{activeKeys.length}</strong>
          <small>Manage integrations</small>
        </Link>
        {managers ? (
          <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/people`}>
            <span>People</span>
            <strong>{members.length}</strong>
            <small>Manage organization members</small>
          </Link>
        ) : null}
      </section>
      {products.length ? (
        <section className="dashboard-card dashboard-overview-products">
          <div className="dashboard-card-heading">
            <div>
              <h2>Products</h2>
              <p>
                {managers
                  ? "Open a product to manage its members and access."
                  : "Open a product to review its details and your access."}
              </p>
            </div>
            <Link className="text-link" href={`/dashboard/${organizationId}/products`}>
              View all
            </Link>
          </div>
          <div className="dashboard-product-preview-list">
            {products.slice(0, 3).map((product) => (
              <Link
                className="dashboard-product-preview"
                href={`/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}`}
                key={product.productRecordId}
              >
                <ProductIcon name={product.name} src={product.iconUrl} />
                <span>
                  <strong>{product.name}</strong>
                  <small>{product.description || product.websiteUrl}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : managers ? (
        <section className="dashboard-empty-card">
          <Image
            alt="A workspace folder ready for its first product and team members."
            className="empty-state-illustration"
            height={1254}
            sizes="88px"
            src="/illustrations/workspace-invitation.png"
            width={1254}
          />
          <div>
            <h2>No products yet</h2>
            <p>Add your first product to start assigning access and creating API keys.</p>
          </div>
          {managers ? (
            <Link
              className="button button-primary"
              href={`/dashboard/${organizationId}/products/new`}
            >
              Create a product
            </Link>
          ) : null}
        </section>
      ) : null}
      <section className="dashboard-next-steps">
        <h2>Next steps</h2>
        <div className="next-step-grid">
          {managers ? (
            <Link href={`/dashboard/${organizationId}/people`}>
              <span>01</span>
              <strong>Manage catalog managers</strong>
              <small>Control who can edit organization and product details.</small>
            </Link>
          ) : null}
          {managers ? (
            <Link href={`/dashboard/${organizationId}/access`}>
              <span>02</span>
              <strong>Create a product</strong>
              <small>Product members and API actions are managed per product.</small>
            </Link>
          ) : null}
          <Link href={`/dashboard/${organizationId}/api-keys`}>
            <span>03</span>
            <strong>Create an API key</strong>
            <small>Use a key for server-to-server requests.</small>
          </Link>
          <Link href="/developers/getting-started">
            <span>04</span>
            <strong>Read the integration guide</strong>
            <small>Connect your product to Perminister.</small>
          </Link>
        </div>
      </section>
    </>
  );
}
