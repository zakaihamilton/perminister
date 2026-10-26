import "server-only";
import type { OrganizationRole } from "@/lib/auth/domain";
import { getCurrentSession, getProductAccessForSubject } from "@/lib/auth/service";
import { notFound, redirect } from "next/navigation";

export type ProductPageRouteParams = { organizationId: string; productId: string };
export type ProductPageParams = { params: Promise<ProductPageRouteParams> };
export type ProductPageSearchParams = { notice?: string; error?: string; reason?: string };
export type ProductPageWithSearchParams = {
  params: Promise<ProductPageRouteParams>;
  searchParams: Promise<ProductPageSearchParams>;
};

export function requireProductManagerRole(
  role: OrganizationRole | undefined,
  organizationId: string,
  productId: string,
): "owner" | "admin" {
  if (role !== "owner" && role !== "admin") {
    redirect(`/dashboard/${organizationId}/products/${encodeURIComponent(productId)}`);
  }
  return role;
}

export async function getProductPageContext(params: Promise<ProductPageRouteParams>) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const { organizationId, productId } = await params;
  const access = await getProductAccessForSubject(
    current.subject.subjectId,
    organizationId,
    productId,
  ).catch(() => null);
  if (!access) notFound();
  return { current, organizationId, productId, access };
}

export async function getProductManagementPageContext(params: Promise<ProductPageRouteParams>) {
  const context = await getProductPageContext(params);
  const role = requireProductManagerRole(
    context.access.membership?.role,
    context.organizationId,
    context.productId,
  );
  if (context.access.product.sharedProductRef) notFound();
  return { ...context, role };
}
