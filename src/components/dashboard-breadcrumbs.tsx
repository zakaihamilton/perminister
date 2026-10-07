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

  return (
    <>
      <nav aria-label="Breadcrumb" className="dashboard-breadcrumbs">
        <ol>
          {items.map((item, index) => {
            const isCurrentPage = index === items.length - 1;
            return (
              <li key={`${item.label}-${index}`}>
                {isCurrentPage ? (
                  <span aria-current="page" className="dashboard-breadcrumb-current">
                    {item.label}
                  </span>
                ) : item.href ? (
                  <Link href={item.href}>{item.label}</Link>
                ) : (
                  <span>{item.label}</span>
                )}
                {!isCurrentPage ? (
                  <span aria-hidden="true" className="dashboard-breadcrumb-separator">
                    /
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>
      <h1 className="dashboard-page-title">{currentPage.label}</h1>
    </>
  );
}

export function DashboardBreadcrumbs(context: DashboardBreadcrumbContext) {
  const pathname = usePathname();
  return <BreadcrumbBar items={buildDashboardBreadcrumbs(pathname, context)} />;
}
