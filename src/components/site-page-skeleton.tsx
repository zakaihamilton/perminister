import { BrandContent } from "@/components/site-shell";
import { skeletonClasses } from "@/components/skeleton-classnames";

type SitePageSkeletonVariant = "marketing" | "document" | "auth" | "authorization";

function Block({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={skeletonClasses("dashboard-skeleton-block", className)}
    />
  );
}

function SiteHeaderSkeleton() {
  return (
    <div className={skeletonClasses("site-skeleton-header")} aria-hidden="true">
      <Block className="is-brand" />
      <div className={skeletonClasses("site-skeleton-header-links")}>
        <Block />
        <Block />
        <Block />
      </div>
    </div>
  );
}

function AuthPageSkeleton() {
  return (
    <>
      <SiteHeaderSkeleton />
      <main className={skeletonClasses("site-skeleton-auth")} aria-hidden="true">
        <div className={skeletonClasses("site-skeleton-auth-card")}>
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

function AuthorizationPageSkeleton() {
  return (
    <main aria-hidden="true" className={skeletonClasses("site-skeleton-authorization")}>
      <header className={skeletonClasses("site-skeleton-authorization-header")}>
        <BrandContent />
      </header>
      <div className={skeletonClasses("site-skeleton-authorization-main")}>
        <section className={skeletonClasses("site-skeleton-authorization-card")}>
          <div className={skeletonClasses("site-skeleton-authorization-loader")}>
            <span className={skeletonClasses("site-skeleton-authorization-icon")}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path d="M12 3.5 19 6v5.2c0 4.2-2.9 7.6-7 9.3-4.1-1.7-7-5.1-7-9.3V6l7-2.5Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <span className={skeletonClasses("site-skeleton-authorization-orbit")} />
          </div>
          <p className={skeletonClasses("site-skeleton-authorization-eyebrow")}>
            Perminister identity
          </p>
          <h1>Checking your access</h1>
          <p className={skeletonClasses("site-skeleton-authorization-description")}>
            We’re finishing your sign-in and getting your app ready.
          </p>
          <p className={skeletonClasses("site-skeleton-authorization-note")}>
            You’ll be returned to your app automatically.
          </p>
        </section>
      </div>
      <footer className={skeletonClasses("site-skeleton-authorization-footer")}>
        Secure access for all your apps
      </footer>
    </main>
  );
}

function MarketingPageSkeleton() {
  return (
    <>
      <SiteHeaderSkeleton />
      <main className={skeletonClasses("site-skeleton-main")} aria-hidden="true">
        <section className={skeletonClasses("site-skeleton-hero")}>
          <div className={skeletonClasses("site-skeleton-hero-copy")}>
            <Block className="is-description" />
            <Block className="is-heading" />
            <Block className="is-heading is-heading-short" />
            <Block className="is-description is-description-long" />
            <Block className="is-heading-action" />
          </div>
          <Block className="site-skeleton-hero-art" />
        </section>
        <section className={skeletonClasses("site-skeleton-section")}>
          <Block className="is-heading" />
          <div className={skeletonClasses("site-skeleton-cards")}>
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
      <main className={skeletonClasses("site-skeleton-document")} aria-hidden="true">
        <Block className="is-description" />
        <Block className="is-heading" />
        <Block className="is-description is-description-long" />
        <div className={skeletonClasses("site-skeleton-document-layout")}>
          <div className={skeletonClasses("site-skeleton-document-nav")}>
            <Block />
            <Block />
            <Block />
            <Block />
          </div>
          <div className={skeletonClasses("site-skeleton-document-copy")}>
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
    <div
      aria-busy="true"
      aria-label={variant === "authorization" ? "Checking your access" : "Loading page"}
      className={skeletonClasses("site-page-skeleton")}
      role="status"
    >
      <span className="visually-hidden">
        {variant === "authorization"
          ? "Perminister is finishing your sign-in and getting your app ready."
          : "Loading page content"}
      </span>
      {variant === "authorization" ? (
        <AuthorizationPageSkeleton />
      ) : variant === "auth" ? (
        <AuthPageSkeleton />
      ) : variant === "document" ? (
        <DocumentPageSkeleton />
      ) : (
        <MarketingPageSkeleton />
      )}
    </div>
  );
}
