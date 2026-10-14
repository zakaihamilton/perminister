import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsumerClientCreationManager } from "@/components/consumer-client-creation-manager";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductNavigation } from "@/components/product-navigation";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageParams,
} from "@/lib/auth/product-page-context";

export default async function NewConsumerClientPage({ params }: ProductPageParams) {
  const { organizationId, productId, access } = await getProductPageContext(params);
  const role = requireProductManagerRole(access.membership?.role, organizationId, productId);
  if (access.product.sharedProductRef) notFound();

  const clientsPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/clients`;
  const createPath = `${clientsPath}/new`;

  return (
    <>
      <DashboardHeading
        description={`Connect an app backend to Perminister for ${access.product.name} sign-in and permission checks.`}
        action={
          <Link className="button button-secondary" href={clientsPath}>
            Back to app clients
          </Link>
        }
      />
      <ProductNavigation
        isSharedInstallation={false}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        role={role}
      />
      <ConsumerClientCreationManager
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        returnTo={createPath}
        clientsPath={clientsPath}
      />
    </>
  );
}
