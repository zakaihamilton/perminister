import { redirect } from "next/navigation";

export default async function OrganizationAccessPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  redirect(`/dashboard/${organizationId}/products`);
}
