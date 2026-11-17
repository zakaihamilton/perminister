export function operationsHref(path: string, organizationId?: string): string {
  if (!organizationId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}organizationId=${encodeURIComponent(organizationId)}`;
}

export function organizationDashboardHref(organizationId?: string): string {
  return organizationId ? `/dashboard/${encodeURIComponent(organizationId)}` : "/dashboard";
}
