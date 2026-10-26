import { DashboardPageSkeleton } from "@/components/dashboard-page-skeleton";

export function DashboardLayoutSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="dashboard-layout" role="status">
      <aside aria-hidden="true" className="dashboard-sidebar dashboard-sidebar-skeleton">
        <div className="dashboard-brand-row">
          <span className="dashboard-skeleton-block is-brand" />
        </div>
        <span className="dashboard-skeleton-block is-switcher" />
        <div className="dashboard-sidebar-skeleton-links">
          {Array.from({ length: 6 }, (_, index) => (
            <span className="dashboard-skeleton-block is-sidebar-link" key={index} />
          ))}
        </div>
        <span className="dashboard-skeleton-block is-signout" />
      </aside>
      <main className="dashboard-main">
        <div className="dashboard-mobile-header">
          <span aria-hidden="true" className="dashboard-skeleton-block is-brand" />
        </div>
        <div className="dashboard-main-inner">
          <DashboardPageSkeleton announce={false} variant="overview" />
        </div>
      </main>
    </div>
  );
}
