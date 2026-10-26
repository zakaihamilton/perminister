import Link from "next/link";
import { ConsumerClientCreationManager } from "@/components/consumer-client-creation-manager";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductPageNavigation } from "@/components/product-navigation";
import {
  getProductManagementPageContext,
  type ProductPageParams,
} from "@/lib/auth/product-page-context";

export default async function NewConsumerClientPage({ params }: ProductPageParams) {
  const { organizationId, productId, access } = await getProductManagementPageContext(params);

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
      <ProductPageNavigation
        access={access}
        organizationId={organizationId}
        productId={productId}
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
