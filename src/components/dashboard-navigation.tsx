"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DashboardNavigation({
  organizationId,
  role,
}: {
  organizationId: string;
  role: "owner" | "admin" | "member";
}) {
  const pathname = usePathname();
  const root = `/dashboard/${organizationId}`;
  const canManage = role === "owner" || role === "admin";
  const workspaceLinks = [
    { label: "Overview", href: root, key: "overview" },
    ...(canManage ? [{ label: "Products", href: `${root}/products`, key: "products" }] : []),
    { label: "Access", href: `${root}/access`, key: "access" },
    { label: "API keys", href: `${root}/api-keys`, key: "api-keys" },
    ...(canManage
      ? [
          { label: "People", href: `${root}/people`, key: "people" },
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
        : pathname.startsWith(`${root}/access`)
          ? "access"
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
