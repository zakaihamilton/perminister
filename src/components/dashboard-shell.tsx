import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions";
import { Brand } from "@/components/site-shell";
import type { OrganizationSummary } from "@/lib/auth/service";
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs";
import { DashboardNavigation } from "@/components/dashboard-navigation";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { ThemeControl } from "@/components/theme-control";
import { Tooltip } from "@/components/tooltip";
import type { DashboardBreadcrumbProduct } from "@/lib/dashboard-breadcrumbs";

export function DashboardShell({
  organizationId,
  organizationName,
  products = [],
  organizations,
  role,
  email,
  children,
}: {
  organizationId: string;
  organizationName: string;
  products?: DashboardBreadcrumbProduct[];
  organizations: OrganizationSummary[];
  role: "owner" | "admin" | "member";
  email: string | null;
  children: ReactNode;
}) {
  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand-row">
          <Brand />
        </div>
        <OrganizationSwitcher organizations={organizations} organizationId={organizationId} />
        <DashboardNavigation organizationId={organizationId} role={role} />
        <div className="dashboard-sidebar-theme">
          <ThemeControl />
        </div>
        <div className="dashboard-sidebar-footer">
          {email ? (
            <div className="sidebar-email-tooltip">
              <Tooltip
                content={email}
                trigger={
                  <button
                    aria-label="Show full email address"
                    className="sidebar-email"
                    type="button"
                  >
                    {email}
                  </button>
                }
              />
            </div>
          ) : null}
          <form action={signOutAction}>
            <button className="button button-secondary sidebar-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="dashboard-main">
        <div className="dashboard-mobile-brand">
          <Brand />
        </div>
        <div className="dashboard-main-inner">
          <DashboardBreadcrumbs
            organizationId={organizationId}
            organizationName={organizationName}
            products={products}
          />
          {children}
        </div>
      </main>
    </div>
  );
}

export function DashboardHeading({
  description,
  action,
}: {
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="dashboard-page-heading">
      {description ? <p>{description}</p> : null}
      {action ? <div className="dashboard-heading-action">{action}</div> : null}
    </header>
  );
}

export function DashboardNotice({
  message,
  kind = "info",
}: {
  message: string;
  kind?: "info" | "success" | "error";
}) {
  return (
    <div className={`dashboard-notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {message}
    </div>
  );
}
