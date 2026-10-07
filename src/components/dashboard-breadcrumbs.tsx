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
  const currentPage = items[items.length - 1];
  const ancestors = items.slice(0, -1);

  return (
    <>
      {ancestors.length ? (
        <nav aria-label="Breadcrumb" className="dashboard-breadcrumbs">
          <ol>
            {ancestors.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                {item.href ? <Link href={item.href}>{item.label}</Link> : <span>{item.label}</span>}
                {index < ancestors.length - 1 ? (
                  <span aria-hidden="true" className="dashboard-breadcrumb-separator">
                    /
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 className="dashboard-page-title">{currentPage.label}</h1>
    </>
  );
}

export function DashboardBreadcrumbs(context: DashboardBreadcrumbContext) {
  const pathname = usePathname();
  return <BreadcrumbBar items={buildDashboardBreadcrumbs(pathname, context)} />;
}
