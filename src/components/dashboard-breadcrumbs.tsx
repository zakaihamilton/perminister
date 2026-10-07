"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  buildDashboardBreadcrumbs,
  type DashboardBreadcrumbContext,
  type DashboardBreadcrumbItem,
} from "@/lib/dashboard-breadcrumbs";

export function BreadcrumbBar({ items }: { items: readonly DashboardBreadcrumbItem[] }) {
  if (items.length === 0) return null;
  const lastIndex = items.length - 1;

  return (
    <nav aria-label="Breadcrumb" className="dashboard-breadcrumbs">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index < lastIndex && item.href ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <h1 aria-current="page" className="dashboard-breadcrumb-current">
                {item.label}
              </h1>
            )}
            {index < lastIndex ? (
              <span aria-hidden="true" className="dashboard-breadcrumb-separator">
                /
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function DashboardBreadcrumbs(context: DashboardBreadcrumbContext) {
  const pathname = usePathname();
  return <BreadcrumbBar items={buildDashboardBreadcrumbs(pathname, context)} />;
}
