import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions";
import { Brand } from "@/components/site-shell";
import type { OrganizationSummary } from "@/lib/auth/service";
import { DashboardNavigation } from "@/components/dashboard-navigation";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import Link from "next/link";
import { ThemeControl } from "@/components/theme-control";
import { Tooltip } from "@/components/tooltip";

export function DashboardShell({
  organizationId,
  organizations,
  role,
  email,
  children,
}: {
  organizationId: string;
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
        <Link className="org-create-link" href="/dashboard/new-organization">
          ＋ Create organization
        </Link>
        <DashboardNavigation organizationId={organizationId} role={role} />
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
            <button className="sidebar-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="dashboard-main">
        <div className="dashboard-mobile-brand">
          <Brand />
        </div>
        <header aria-label="Workspace controls" className="dashboard-topbar">
          <span className="dashboard-topbar-context">
            {organizations.find(
              ({ organization }) => organization.organizationId === organizationId,
            )?.organization.name ?? "Workspace"}
          </span>
          <ThemeControl />
        </header>
        <div className="dashboard-main-inner">{children}</div>
      </main>
    </div>
  );
}

export function DashboardHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="dashboard-page-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
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
