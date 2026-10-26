export type DashboardPageSkeletonVariant =
  "overview" | "catalog" | "people" | "activity" | "form" | "profile" | "detail" | "operations";

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`dashboard-skeleton-block ${className}`} />;
}

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="dashboard-skeleton-rows">
      {Array.from({ length: count }, (_, index) => (
        <div className="dashboard-skeleton-row" key={index}>
          <SkeletonBlock className="is-avatar" />
          <div className="dashboard-skeleton-row-copy">
            <SkeletonBlock className="is-row-title" />
            <SkeletonBlock className="is-row-detail" />
          </div>
          <SkeletonBlock className="is-row-action" />
        </div>
      ))}
    </div>
  );
}

function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="dashboard-skeleton-card">
      <SkeletonBlock className="is-card-title" />
      <SkeletonBlock className="is-card-description" />
      <SkeletonRows count={rows} />
    </div>
  );
}

function SkeletonContent({ variant }: { variant: DashboardPageSkeletonVariant }) {
  if (variant === "form") {
    return (
      <div className="dashboard-skeleton-grid is-form">
        <div className="dashboard-skeleton-card">
          <SkeletonBlock className="is-card-title" />
          <SkeletonBlock className="is-card-description" />
          <SkeletonBlock className="is-form-label" />
          <SkeletonBlock className="is-form-field" />
          <SkeletonBlock className="is-form-label" />
          <SkeletonBlock className="is-form-field is-tall" />
          <SkeletonBlock className="is-form-submit" />
        </div>
      </div>
    );
  }

  if (variant === "overview") {
    return (
      <>
        <div className="dashboard-skeleton-metrics">
          <SkeletonCard rows={0} />
          <SkeletonCard rows={0} />
          <SkeletonCard rows={0} />
        </div>
        <div className="dashboard-skeleton-grid is-two-column">
          <SkeletonCard rows={4} />
          <SkeletonCard rows={4} />
        </div>
      </>
    );
  }

  if (variant === "activity") {
    return (
      <div className="dashboard-skeleton-grid is-one-column">
        <SkeletonCard rows={6} />
      </div>
    );
  }

  if (variant === "profile" || variant === "detail") {
    return (
      <div className="dashboard-skeleton-grid is-one-column">
        <SkeletonCard rows={variant === "profile" ? 3 : 5} />
        {variant === "detail" ? <SkeletonCard rows={3} /> : null}
      </div>
    );
  }

  if (variant === "operations") {
    return (
      <div className="dashboard-skeleton-grid is-two-column">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={3} />
        <SkeletonCard rows={3} />
        <SkeletonCard rows={3} />
      </div>
    );
  }

  return (
    <div
      className={`dashboard-skeleton-grid${variant === "people" ? " is-two-column" : " is-one-column"}`}
    >
      <SkeletonCard rows={variant === "people" ? 5 : 6} />
      {variant === "people" ? <SkeletonCard rows={4} /> : null}
    </div>
  );
}

export function DashboardPageSkeleton({
  variant = "catalog",
  announce = true,
}: {
  variant?: DashboardPageSkeletonVariant;
  announce?: boolean;
}) {
  return (
    <section
      aria-busy="true"
      aria-label={announce ? "Loading page" : undefined}
      className={`dashboard-page-skeleton variant-${variant}`}
      role={announce ? "status" : undefined}
    >
      {announce ? <span className="visually-hidden">Loading page content</span> : null}
      <div aria-hidden="true">
        <div className="dashboard-skeleton-heading">
          <div className="dashboard-skeleton-heading-copy">
            <SkeletonBlock className="is-heading" />
            <SkeletonBlock className="is-description" />
          </div>
          <SkeletonBlock className="is-heading-action" />
        </div>
        {variant === "catalog" ? (
          <div className="dashboard-skeleton-grid is-two-column">
            <SkeletonCard rows={3} />
            <SkeletonCard rows={3} />
          </div>
        ) : (
          <SkeletonContent variant={variant} />
        )}
      </div>
    </section>
  );
}
