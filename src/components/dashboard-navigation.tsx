"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavigationItem = { label: string; href: string; key: string };

function NavigationLinkList({ items, activeKey }: { items: NavigationItem[]; activeKey?: string }) {
  return items.map((item) => (
    <Link
      className="dashboard-nav-link"
      href={item.href}
      key={item.key}
      aria-current={activeKey === item.key ? "page" : undefined}
    >
      <span className={`dashboard-nav-mark mark-${item.key}`} aria-hidden="true" />
      {item.label}
    </Link>
  ));
}

export function DashboardNavigation({
  organizationId,
  role,
  isPlatformAdministrator,
  pendingOrganizationRequestCount,
}: {
  organizationId?: string;
  role?: "owner" | "admin" | "member";
  isPlatformAdministrator: boolean;
  pendingOrganizationRequestCount: number | null;
}) {
  const pathname = usePathname();
  const root = organizationId ? `/dashboard/${organizationId}` : null;
  const canManage = role === "owner" || role === "admin";
  const organizationLinks: NavigationItem[] = root
    ? [
        { label: "Overview", href: root, key: "overview" },
        { label: "Products", href: `${root}/products`, key: "products" },
        { label: "API keys", href: `${root}/api-keys`, key: "api-keys" },
        ...(canManage
          ? [
              { label: "Members", href: `${root}/people`, key: "people" },
              { label: "Activity", href: `${root}/activity`, key: "activity" },
            ]
          : []),
        ...(role === "owner"
          ? [{ label: "Organization settings", href: `${root}/settings`, key: "settings" }]
          : []),
      ]
    : [];
  const accountLinks: NavigationItem[] = root
    ? [{ label: "Account", href: `${root}/profile`, key: "profile" }]
    : [];
  const activeKey = pathname.startsWith("/dashboard/operations")
    ? "operations"
    : !root
      ? undefined
      : pathname === root
        ? "overview"
        : pathname.startsWith(`${root}/products`)
          ? "products"
          : pathname.startsWith(`${root}/api-keys`)
            ? "api-keys"
            : pathname.startsWith(`${root}/people`)
              ? "people"
              : pathname.startsWith(`${root}/activity`)
                ? "activity"
                : pathname.startsWith(`${root}/settings`)
                  ? "settings"
                  : pathname.startsWith(`${root}/profile`) ||
                      pathname.startsWith(`${root}/sessions`)
                    ? "profile"
                    : undefined;

  return (
    <nav className="dashboard-nav" aria-label="Dashboard pages">
      {organizationLinks.length ? <p className="dashboard-nav-label">Organization</p> : null}
      <NavigationLinkList items={organizationLinks} activeKey={activeKey} />
      {isPlatformAdministrator ? (
        <>
          <p className="dashboard-nav-label platform-nav-label">Platform</p>
          <Link
            className="dashboard-nav-link"
            href="/dashboard/operations"
            aria-label={
              pendingOrganizationRequestCount
                ? `Platform admin, ${pendingOrganizationRequestCount} pending organization requests`
                : "Platform admin"
            }
            aria-current={activeKey === "operations" ? "page" : undefined}
          >
            <span className="dashboard-nav-mark mark-operations" aria-hidden="true" />
            <span>Platform admin</span>
            {pendingOrganizationRequestCount ? (
              <span className="dashboard-nav-count" aria-hidden="true">
                {pendingOrganizationRequestCount}
              </span>
            ) : null}
          </Link>
        </>
      ) : null}
      {accountLinks.length ? (
        <div className="dashboard-account-nav">
          <NavigationLinkList items={accountLinks} activeKey={activeKey} />
        </div>
      ) : null}
    </nav>
  );
}
