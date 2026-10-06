import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { ProductSetupForm } from "@/components/product-setup-form";
import { getCurrentSession, getOrganizationForSubject } from "@/lib/auth/service";

export default async function NewProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const organization = await getOrganizationForSubject(
    current.subject.subjectId,
    organizationId,
  ).catch(() => null);
  if (!organization) notFound();
  if (organization.membership.role === "member") redirect(`/dashboard/${organizationId}/access`);
  return (
    <>
      <DashboardHeading
        eyebrow="Products"
        title="Create a product"
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
