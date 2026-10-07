import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { updateOrganizationProductAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import {
  getCurrentSession,
  getProductAccessForSubject,
} from "@/lib/auth/service";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; productId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId, productId }, query] = await Promise.all([params, searchParams]);
  const productAccess = await getProductAccessForSubject(
    current.subject.subjectId,
    organizationId,
    productId,
  ).catch(() => null);
  if (!productAccess) notFound();
  const product = productAccess.product;
  const canManageDetails = productAccess.catalogManager;
  const productRole = productAccess.membership?.role;
  return (
    <>
      <DashboardHeading
        eyebrow="Products"
        title={product.name}
        description={product.description || "Product details and stable integration ID."}
        action={
          productRole === "owner" || productRole === "admin" ? (
            <div className="product-detail-actions">
              <Link className="button button-secondary" href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/people`}>
                People
              </Link>
              <Link className="button button-secondary" href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}>
                Access
              </Link>
              <Link className="button button-secondary" href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/activity`}>
                Activity
              </Link>
            </div>
          ) : productRole === "member" ? (
            <div className="product-detail-actions">
              <Link className="button button-secondary" href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/access`}>
                My access
              </Link>
              <Link className="button button-secondary" href={`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/activity`}>
                Activity
              </Link>
            </div>
          ) : undefined
        }
      />
      {query.notice === "product-created" ? (
        <DashboardNotice
          message="Product created. You can now assign access to team members."
          kind="success"
        />
      ) : null}
      {query.notice === "product-updated" ? (
        <DashboardNotice message="Product details saved." kind="success" />
      ) : null}
      <section className="dashboard-card product-detail-card">
        <div className="product-detail-top">
          {product.iconUrl ? (
            <Image alt="" height={40} src={product.iconUrl} unoptimized width={40} />
          ) : (
            <span className="product-placeholder">{product.name.slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <span className="eyebrow">Product ID</span>
            <code className="product-id-code">{product.productId}</code>
            <a className="text-link" href={product.websiteUrl} target="_blank" rel="noreferrer">
              Open website ↗
            </a>
          </div>
        </div>
        {canManageDetails ? (
          <form action={updateOrganizationProductAction} className="auth-form product-edit-form">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="productRecordId" value={product.productRecordId} />
            <h2>Product details</h2>
            <label>
              Name
              <input name="name" defaultValue={product.name} required maxLength={120} />
            </label>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={product.description}
                maxLength={500}
                rows={3}
              />
            </label>
            <label>
              Website
              <input
                name="websiteUrl"
                type="url"
                defaultValue={product.websiteUrl}
                required
                maxLength={2048}
              />
            </label>
            <label>
              Icon URL
              <input name="iconUrl" type="url" defaultValue={product.iconUrl} maxLength={2048} />
            </label>
            <p className="form-hint">
              The product ID is fixed after creation so existing integrations keep working.
            </p>
            <button className="button button-primary" type="submit">
              Save product details
            </button>
          </form>
        ) : (
          <dl className="product-detail-list">
            <dt>Website</dt>
            <dd>
              <a href={product.websiteUrl} target="_blank" rel="noreferrer">
                {product.websiteUrl}
              </a>
            </dd>
            <dt>Created</dt>
            <dd>{new Date(product.createdAt).toLocaleDateString()}</dd>
          </dl>
        )}
      </section>
    </>
  );
}
