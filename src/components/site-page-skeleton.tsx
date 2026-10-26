type SitePageSkeletonVariant = "marketing" | "document" | "auth" | "authorization";

function Block({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`dashboard-skeleton-block ${className}`} />;
}

function SiteHeaderSkeleton() {
  return (
    <header className="site-skeleton-header" aria-hidden="true">
      <Block className="is-brand" />
      <div className="site-skeleton-header-links">
        <Block />
        <Block />
        <Block />
      </div>
    </header>
  );
}

function AuthPageSkeleton() {
  return (
    <>
      <SiteHeaderSkeleton />
      <main className="site-skeleton-auth" aria-hidden="true">
        <div className="site-skeleton-auth-card">
          <Block className="is-heading" />
          <Block className="is-description" />
          <Block className="is-form-label" />
          <Block className="is-form-field" />
          <Block className="is-form-label" />
          <Block className="is-form-field" />
          <Block className="is-form-submit" />
        </div>
      </main>
    </>
  );
}

function MarketingPageSkeleton() {
  return (
    <>
      <SiteHeaderSkeleton />
      <main className="site-skeleton-main" aria-hidden="true">
        <section className="site-skeleton-hero">
          <div className="site-skeleton-hero-copy">
            <Block className="is-description" />
            <Block className="is-heading" />
            <Block className="is-heading is-heading-short" />
            <Block className="is-description is-description-long" />
            <Block className="is-heading-action" />
          </div>
          <Block className="site-skeleton-hero-art" />
        </section>
        <section className="site-skeleton-section">
          <Block className="is-heading" />
          <div className="site-skeleton-cards">
            <Block />
            <Block />
            <Block />
          </div>
        </section>
      </main>
    </>
  );
}

function DocumentPageSkeleton() {
  return (
    <>
      <SiteHeaderSkeleton />
      <main className="site-skeleton-document" aria-hidden="true">
        <Block className="is-description" />
        <Block className="is-heading" />
        <Block className="is-description is-description-long" />
        <div className="site-skeleton-document-layout">
          <div className="site-skeleton-document-nav">
            <Block />
            <Block />
            <Block />
            <Block />
          </div>
          <div className="site-skeleton-document-copy">
            {Array.from({ length: 5 }, (_, index) => (
              <section key={index}>
                <Block className="is-card-title" />
                <Block className="is-description is-description-long" />
                <Block className="is-description is-description-long" />
                <Block className="is-description" />
              </section>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

export function SitePageSkeleton({ variant }: { variant: SitePageSkeletonVariant }) {
  return (
    <div aria-busy="true" aria-label="Loading page" className="site-page-skeleton" role="status">
      <span className="visually-hidden">Loading page content</span>
      {variant === "auth" || variant === "authorization" ? (
        <AuthPageSkeleton />
      ) : variant === "document" ? (
        <DocumentPageSkeleton />
      ) : (
        <MarketingPageSkeleton />
      )}
    </div>
  );
}
