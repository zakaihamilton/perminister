import Link from "next/link";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { getCurrentSession, getOrganizationForSubject, listProductsForOrganization } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const [organization, products] = await Promise.all([
    getOrganizationForSubject(current.subject.subjectId, organizationId),
    listProductsForOrganization(current.subject.subjectId, organizationId),
  ]);
  const canManage = organization.membership.role !== "member";
  if (!canManage) redirect(`/dashboard/${organizationId}/access`);
  return (
    <>
      <DashboardHeading
        eyebrow="Workspace"
        title="Products"
        description="Manage the products in this organization and the access attached to each one."
        action={canManage ? <Link className="button button-primary" href={`/dashboard/${organizationId}/products/new`}>Create product</Link> : undefined}
      />
      {query.notice === "product-updated" ? <DashboardNotice message="Product details saved." kind="success" /> : null}
      {query.error === "product-update" ? <DashboardNotice message="Product details could not be saved." kind="error" /> : null}
      {products.length ? (
        <div className="product-catalog">
          {products.map((product) => (
            <Link className="product-card" href={`/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}`} key={product.productRecordId}>
              {product.iconUrl ? <img src={product.iconUrl} alt="" referrerPolicy="no-referrer" /> : <span className="product-placeholder">{product.name.slice(0, 1).toUpperCase()}</span>}
              <span className="product-card-copy"><strong>{product.name}</strong><small>{product.description || product.websiteUrl}</small><code>{product.productId}</code></span>
              <span className="product-card-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      ) : (
        <section className="dashboard-empty-card">
          <span className="empty-card-icon" aria-hidden="true">✦</span>
          <div><h2>Your product catalog starts here</h2><p>Add a website and we’ll suggest the name, description, and icon.</p></div>
          {canManage ? <Link className="button button-primary" href={`/dashboard/${organizationId}/products/new`}>Create your first product</Link> : null}
        </section>
      )}
    </>
  );
}
