"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DashboardNavigation({
  organizationId,
  role,
  isPlatformAdministrator,
  pendingOrganizationRequestCount,
}: {
  organizationId: string;
  role: "owner" | "admin" | "member";
  isPlatformAdministrator: boolean;
  pendingOrganizationRequestCount: number | null;
}) {
  const pathname = usePathname();
  const root = `/dashboard/${organizationId}`;
  const canManage = role === "owner" || role === "admin";
  const workspaceLinks = [
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
  ];
  const accountLinks = [
    { label: "Profile", href: `${root}/profile`, key: "profile" },
    { label: "Sessions", href: `${root}/sessions`, key: "sessions" },
  ];
  const activeKey =
    pathname === root
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
      <p className="dashboard-nav-label">Workspace</p>
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
                ? `Organization requests, ${pendingOrganizationRequestCount} pending`
                : "Organization requests"
            }
          >
            <span className="dashboard-nav-mark mark-operations" aria-hidden="true" />
            <span>Organization requests</span>
            {pendingOrganizationRequestCount ? (
              <span className="dashboard-nav-count" aria-hidden="true">
                {pendingOrganizationRequestCount}
              </span>
            ) : null}
          </Link>
        </>
      ) : null}
      <p className="dashboard-nav-label account-nav-label">Your account</p>
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
