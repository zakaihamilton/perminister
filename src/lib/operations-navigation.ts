import type { DashboardBreadcrumbItem } from "@/lib/dashboard-breadcrumbs";

export function operationsHref(path: string, organizationId?: string): string {
  if (!organizationId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}organizationId=${encodeURIComponent(organizationId)}`;
}

export function organizationDashboardHref(organizationId?: string): string {
  return organizationId ? `/dashboard/${encodeURIComponent(organizationId)}` : "/dashboard";
}

export function operationsBreadcrumbs(
  organizationId: string | undefined,
  currentPage?: string,
): DashboardBreadcrumbItem[] {
  const breadcrumbs: DashboardBreadcrumbItem[] = [
    { label: "Dashboard", href: organizationDashboardHref(organizationId) },
    {
      label: "Platform admin",
      ...(currentPage ? { href: operationsHref("/dashboard/operations", organizationId) } : {}),
    },
  ];
  if (currentPage) breadcrumbs.push({ label: currentPage });
  return breadcrumbs;
}
