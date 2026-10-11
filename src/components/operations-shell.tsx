import type { ReactNode } from "react";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import type { DashboardBreadcrumbItem } from "@/lib/dashboard-breadcrumbs";

export function OperationsShell({
  breadcrumbs,
  children,
}: {
  breadcrumbs: readonly DashboardBreadcrumbItem[];
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader active="dashboard" authenticated />
      <main className="page-shell operations-page-shell">
        <div className="container operations-page">
          <BreadcrumbBar items={breadcrumbs} />
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
