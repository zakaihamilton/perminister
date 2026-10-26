"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { OrganizationRole } from "@/lib/auth/domain";
import type { ProductAccessSummary } from "@/lib/auth/service";

type ProductNavigationItem = {
  label: string;
  path: string;
};

export function ProductNavigation({
  isSharedInstallation,
  organizationId,
  productId,
  productName,
  role,
}: {
  isSharedInstallation: boolean;
  organizationId: string;
  productId: string;
  productName: string;
  role?: OrganizationRole | null;
}) {
  const pathname = usePathname();
  const productRoot = `/dashboard/${organizationId}/products/${encodeURIComponent(productId)}`;
  const canManage = role === "owner" || role === "admin";
  const items: ProductNavigationItem[] = canManage
    ? [
        { path: "people", label: "Members" },
        { path: "access", label: "Permissions" },
        ...(!isSharedInstallation ? [{ path: "roles", label: "Permission sets" }] : []),
        { path: "clients", label: "App clients" },
        { path: "api-keys", label: "API keys" },
        { path: "activity", label: "Activity" },
      ]
    : role === "member"
      ? [
          { path: "access", label: "Permissions" },
          { path: "api-keys", label: "API keys" },
          { path: "activity", label: "Activity" },
        ]
      : [];

  if (!items.length) return null;

  return (
    <nav className="product-nav" aria-label={`${productName} pages`}>
      {items.map((item) => {
        const href = `${productRoot}/${item.path}`;
        const isActive = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className="product-nav-link"
            href={href}
            key={item.path}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ProductPageNavigation({
  access,
  organizationId,
  productId,
}: {
  access: Pick<ProductAccessSummary, "product" | "membership">;
  organizationId: string;
  productId: string;
}) {
  return (
    <ProductNavigation
      isSharedInstallation={Boolean(access.product.sharedProductRef)}
      organizationId={organizationId}
      productId={productId}
      productName={access.product.name}
      role={access.membership?.role}
    />
  );
}
