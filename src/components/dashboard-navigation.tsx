"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  const workspaceLinks = root
    ? [
        { label: "Overview", href: root, key: "overview" },
        { label: "Products", href: `${root}/products`, key: "products" },
        { label: "API keys", href: `${root}/api-keys`, key: "api-keys" },
        ...(canManage
          ? [
              { label: "Catalog managers", href: `${root}/people`, key: "people" },
              { label: "Activity", href: `${root}/activity`, key: "activity" },
            ]
          : []),
        ...(role === "owner"
          ? [{ label: "Organization settings", href: `${root}/settings`, key: "settings" }]
          : []),
      ]
    : [];
  const accountLinks = root
    ? [
        { label: "Profile", href: `${root}/profile`, key: "profile" },
        { label: "Sessions", href: `${root}/sessions`, key: "sessions" },
      ]
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
                  : pathname.startsWith(`${root}/profile`)
                    ? "profile"
                    : pathname.startsWith(`${root}/sessions`)
                      ? "sessions"
                      : undefined;

  return (
    <nav className="dashboard-nav" aria-label="Dashboard pages">
      {workspaceLinks.length ? <p className="dashboard-nav-label">Workspace</p> : null}
      {workspaceLinks.map((item) => (
        <Link
          className="dashboard-nav-link"
          href={item.href}
          key={item.key}
          aria-current={activeKey === item.key ? "page" : undefined}
        >
          <span className={`dashboard-nav-mark mark-${item.key}`} aria-hidden="true" />
          {item.label}
        </Link>
      ))}
      {isPlatformAdministrator ? (
        <>
          <p className="dashboard-nav-label platform-nav-label">Platform</p>
          <Link
            className="dashboard-nav-link"
            href="/dashboard/operations"
            aria-label={
              pendingOrganizationRequestCount
                ? `Platform operations, ${pendingOrganizationRequestCount} pending organization requests`
                : "Platform operations"
            }
            aria-current={activeKey === "operations" ? "page" : undefined}
          >
            <span className="dashboard-nav-mark mark-operations" aria-hidden="true" />
            <span>Platform operations</span>
            {pendingOrganizationRequestCount ? (
              <span className="dashboard-nav-count" aria-hidden="true">
                {pendingOrganizationRequestCount}
              </span>
            ) : null}
          </Link>
        </>
      ) : null}
      {accountLinks.length ? (
        <p className="dashboard-nav-label account-nav-label">Your account</p>
      ) : null}
      {accountLinks.map((item) => (
        <Link
          className="dashboard-nav-link"
          href={item.href}
          key={item.key}
          aria-current={activeKey === item.key ? "page" : undefined}
        >
          <span className={`dashboard-nav-mark mark-${item.key}`} aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
