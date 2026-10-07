import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ProductSetupForm } from "@/components/product-setup-form";
import { getOrganizationForSubject } from "@/lib/auth/service";
import { getOrganizationDashboardRequestContext } from "@/lib/auth/organization-dashboard-context";

export default async function NewProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { current, organizationId, query } = await getOrganizationDashboardRequestContext(
    params,
    searchParams,
  );
  const organization = await getOrganizationForSubject(
    current.subject.subjectId,
    organizationId,
  ).catch(() => null);
  if (!organization) notFound();
  if (!organization.catalogManager) redirect(`/dashboard/${organizationId}/products`);
  return (
    <>
      <DashboardHeading
        description="Start with your website and review the details before adding the product."
        action={
          <Link className="button button-secondary" href={`/dashboard/${organizationId}/products`}>
            Back to products
          </Link>
        }
      />
      {query.error ? <DashboardNotice message={query.error} kind="error" /> : null}
      <ProductSetupForm organizationId={organizationId} />
    </>
  );
}
