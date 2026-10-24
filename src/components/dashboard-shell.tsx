import type { ReactNode } from "react";
import { Brand } from "@/components/site-shell";
import type { OrganizationSummary } from "@/lib/auth/service";
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs";
import { DashboardNavigation } from "@/components/dashboard-navigation";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { ThemeControl } from "@/components/theme-control";
import { MobileNavDrawer } from "@/components/mobile-nav-drawer";
import type { DashboardBreadcrumbProduct } from "@/lib/dashboard-breadcrumbs";

export function DashboardShell({
  organizationId,
  organizationName,
  products = [],
  organizations,
  role,
  isPlatformAdministrator,
  pendingOrganizationRequestCount,
  email,
  firstName,
  lastName,
  children,
}: {
  organizationId: string;
  organizationName: string;
  products?: DashboardBreadcrumbProduct[];
  organizations: OrganizationSummary[];
  role: "owner" | "admin" | "member";
  isPlatformAdministrator: boolean;
  pendingOrganizationRequestCount: number | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  children: ReactNode;
}) {
  const sidebarProps = {
    organizations,
    organizationId,
    role,
    isPlatformAdministrator,
    pendingOrganizationRequestCount,
    email,
    firstName,
    lastName,
  };

  return (
    <DashboardLayoutFrame
      sidebarProps={sidebarProps}
      breadcrumbs={
        <DashboardBreadcrumbs
          organizationId={organizationId}
          organizationName={organizationName}
          products={products}
        />
      }
    >
      {children}
    </DashboardLayoutFrame>
  );
}

export type DashboardSidebarProps = {
  organizations: OrganizationSummary[];
  organizationId?: string;
  role?: "owner" | "admin" | "member";
  isPlatformAdministrator: boolean;
  pendingOrganizationRequestCount: number | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

export function DashboardLayoutFrame({
  sidebarProps,
  breadcrumbs,
  children,
}: {
  sidebarProps: DashboardSidebarProps;
  breadcrumbs: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dashboard-layout">
      <DashboardSidebar {...sidebarProps} />
      <main className="dashboard-main">
        <div className="dashboard-mobile-header">
          <div className="dashboard-mobile-brand">
            <Brand />
          </div>
          <MobileNavDrawer>
            <DashboardSidebarContent {...sidebarProps} />
          </MobileNavDrawer>
        </div>
        <div className="dashboard-main-inner">
          {breadcrumbs}
          {children}
        </div>
      </main>
    </div>
  );
}

export function DashboardSidebarContent({
  organizations,
  organizationId,
  role,
  isPlatformAdministrator,
  pendingOrganizationRequestCount,
  email,
  firstName,
  lastName,
}: DashboardSidebarProps) {
  const displayName = [firstName?.trim(), lastName?.trim()]
    .filter((name): name is string => !!name)
    .join(" ");

  return (
    <>
      <div className="dashboard-brand-row">
        <Brand />
      </div>
      {organizationId ? (
        <OrganizationSwitcher organizations={organizations} organizationId={organizationId} />
      ) : null}
      <DashboardNavigation
        organizationId={organizationId}
        role={role}
        isPlatformAdministrator={isPlatformAdministrator}
        pendingOrganizationRequestCount={pendingOrganizationRequestCount}
      />
      <div className="dashboard-sidebar-theme">
        <ThemeControl />
      </div>
      <div className="dashboard-sidebar-footer">
        {email || displayName ? (
          <div className="sidebar-account">
            {email ? <div className="sidebar-email">{email}</div> : null}
            {displayName ? <p className="sidebar-account-name">{displayName}</p> : null}
          </div>
        ) : null}
        <form action="/logout/submit" method="post">
          <button className="button button-secondary sidebar-signout" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}

export function DashboardSidebar(props: DashboardSidebarProps) {
  return (
    <aside className="dashboard-sidebar">
      <DashboardSidebarContent {...props} />
    </aside>
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
