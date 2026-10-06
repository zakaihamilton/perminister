import Link from "next/link";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { getCurrentSession, getOrganizationForSubject, listApiKeysForSubject, listOrganizationMembers, listOrganizationPermissionGrants, listProductsForOrganization } from "@/lib/auth/service";
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
  const [organization, products, grants, keys] = await Promise.all([
    getOrganizationForSubject(current.subject.subjectId, organizationId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
    listOrganizationPermissionGrants(current.subject.subjectId, organizationId),
    listApiKeysForSubject(current.subject.subjectId),
  ]);
  const managers = organization.membership.role === "owner" || organization.membership.role === "admin";
  const members = managers ? await listOrganizationMembers(current.subject.subjectId, organizationId) : [];
  const orgKeys = keys.filter((key) => key.scope.organizationId === organizationId);
  const activeKeys = orgKeys.filter((key) => key.status === "active" && (!key.expiresAt || Date.parse(key.expiresAt) > Date.now()));

  return (
    <>
      <DashboardHeading eyebrow={organization.organization.name} title="Overview" description={managers ? "Manage products, people, and access for your organization." : "See the products and access assigned to you."} />
      {query.notice === "invitation-accepted" ? <DashboardNotice message="You joined the organization. Check the Access page to see what you can use." kind="success" /> : null}
      <section className="dashboard-metric-grid" aria-label="Workspace summary">
        {managers ? <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/products`}><span>Products</span><strong>{products.length}</strong><small>View product catalog</small></Link> : null}
        <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/access`}><span>{managers ? "Access grants" : "Your grants"}</span><strong>{grants.length}</strong><small>Review permissions</small></Link>
        <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/api-keys`}><span>Your API keys</span><strong>{activeKeys.length}</strong><small>Manage integrations</small></Link>
        {managers ? <Link className="dashboard-metric-card" href={`/dashboard/${organizationId}/people`}><span>People</span><strong>{members.length}</strong><small>Manage organization members</small></Link> : null}
      </section>
      {managers && products.length ? (
        <section className="dashboard-card dashboard-overview-products">
          <div className="dashboard-card-heading"><div><h2>Products</h2><p>Start with a product to manage its access.</p></div><Link className="text-link" href={`/dashboard/${organizationId}/products`}>View all</Link></div>
          <div className="dashboard-product-preview-list">
            {products.slice(0, 3).map((product) => (
              <Link className="dashboard-product-preview" href={`/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}`} key={product.productRecordId}>
                {product.iconUrl ? <img src={product.iconUrl} alt="" referrerPolicy="no-referrer" /> : <span className="product-placeholder">{product.name.slice(0, 1).toUpperCase()}</span>}
                <span><strong>{product.name}</strong><small>{product.description || product.websiteUrl}</small></span>
              </Link>
            ))}
          </div>
        </section>
      ) : managers ? (
        <section className="dashboard-empty-card">
          <span className="empty-card-icon" aria-hidden="true">＋</span>
          <div><h2>No products yet</h2><p>Add your first product to start assigning access and creating API keys.</p></div>
          {managers ? <Link className="button button-primary" href={`/dashboard/${organizationId}/products/new`}>Create a product</Link> : null}
        </section>
      ) : null}
      <section className="dashboard-next-steps">
        <h2>Next steps</h2>
        <div className="next-step-grid">
          {managers ? <Link href={`/dashboard/${organizationId}/people`}><span>01</span><strong>Invite your team</strong><small>Give teammates the right organization role.</small></Link> : null}
          {managers ? <Link href={`/dashboard/${organizationId}/access`}><span>02</span><strong>Assign product access</strong><small>Choose a product, person, and allowed actions.</small></Link> : null}
          <Link href={`/dashboard/${organizationId}/api-keys`}><span>03</span><strong>Create an API key</strong><small>Use a key for server-to-server requests.</small></Link>
          <Link href="/developers/getting-started"><span>04</span><strong>Read the integration guide</strong><small>Connect your product to Perminister.</small></Link>
        </div>
      </section>
    </>
  );
}
