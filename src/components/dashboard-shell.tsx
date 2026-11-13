import type { ReactNode } from "react";
import { DashboardShell as PanelFrameDashboardShell } from "panel-frame-ui";
import styles from "./dashboard-shell.module.css";
import { BrandContent } from "@/components/site-shell";
import type { OrganizationSummary } from "@/lib/auth/service";
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs";
import { DashboardNavigation } from "@/components/dashboard-navigation";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { ThemeControl } from "@/components/theme-control";
import type { DashboardBreadcrumbProduct } from "@/lib/dashboard-breadcrumbs";

export function DashboardShell({
  organizationId,
  organizationName,
  products = [],
  organizations,
  sidebarOrganizationSwitcher,
  breadcrumbs,
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
  sidebarOrganizationSwitcher?: ReactNode;
  breadcrumbs?: ReactNode;
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
    organizationSwitcher: sidebarOrganizationSwitcher,
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
        breadcrumbs ?? (
          <DashboardBreadcrumbs
            organizationId={organizationId}
            organizationName={organizationName}
            products={products}
          />
        )
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
  organizationSwitcher?: ReactNode;
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
  const {
    organizations,
    organizationId,
    role,
    isPlatformAdministrator,
    pendingOrganizationRequestCount,
    email,
    firstName,
    lastName,
    organizationSwitcher,
  } = sidebarProps;
  const displayName = [firstName?.trim(), lastName?.trim()]
    .filter((name): name is string => !!name)
    .join(" ");

  return (
    <PanelFrameDashboardShell
      brand={<BrandContent />}
      sidebarContext={
        organizationSwitcher !== undefined
          ? organizationSwitcher
          : organizationId && organizations.length > 0
            ? <OrganizationSwitcher organizations={organizations} organizationId={organizationId} />
            : undefined
      }
      navigation={
        <DashboardNavigation
          organizationId={organizationId}
          role={role}
          isPlatformAdministrator={isPlatformAdministrator}
          pendingOrganizationRequestCount={pendingOrganizationRequestCount}
        />
      }
      sidebarFooter={
        <>
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
              <button className="button button-secondary pf-sidebar-link pf-sign-out" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </>
      }
      toolbar={breadcrumbs}
      contentAsMain={false}
    >
      <main className={styles.content}>{children}</main>
    </PanelFrameDashboardShell>
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
