import { notFound } from "next/navigation";
import { ConsumerClientSettingsForm } from "@/components/consumer-client-settings-form";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductNavigation } from "@/components/product-navigation";
import { getProductPageContext, requireProductManagerRole } from "@/lib/auth/product-page-context";
import { listConsumerClientsForProduct } from "@/lib/auth/service";

interface ConsumerClientEditPageProps {
  params: Promise<{ organizationId: string; productId: string; clientId: string }>;
}

export default async function ConsumerClientEditPage({ params }: ConsumerClientEditPageProps) {
  const [{ current, organizationId, productId, access }, routeParams] = await Promise.all([
    getProductPageContext(params),
    params,
  ]);
  const role = requireProductManagerRole(access.membership?.role, organizationId, productId);
  if (access.product.sharedProductRef) notFound();

  const clients = await listConsumerClientsForProduct(
    current.subject.subjectId,
    organizationId,
    productId,
  );
  const client = clients.find(
    (entry) => entry.clientId === routeParams.clientId && entry.status === "active",
  );
  if (!client) notFound();

  const clientsPath = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}/clients`;
  const editPath = `${clientsPath}/${encodeURIComponent(client.clientId)}/edit`;

  return (
    <>
      <DashboardHeading description={`Update settings for ${client.appName}.`} />
      <ProductNavigation
        isSharedInstallation={false}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        role={role}
      />
      <ConsumerClientSettingsForm
        client={client}
        organizationId={organizationId}
        productId={productId}
        returnTo={editPath}
        clientsPath={clientsPath}
      />
    </>
  );
}
