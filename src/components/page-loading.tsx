type PageLoadingProps = {
  variant?: "screen" | "section";
};

export function PageLoading({ variant = "screen" }: PageLoadingProps) {
  return (
    <div aria-busy="true" className={`page-loading page-loading-${variant}`} role="status">
      <span aria-hidden="true" className="page-loading-boxes">
        <span className="page-loading-box">
          <span className="page-loading-fill" />
        </span>
        <span className="page-loading-box">
          <span className="page-loading-fill page-loading-fill-2" />
        </span>
        <span className="page-loading-box">
          <span className="page-loading-fill page-loading-fill-3" />
        </span>
        <span className="page-loading-box">
          <span className="page-loading-fill page-loading-fill-4" />
        </span>
        <span className="page-loading-box">
          <span className="page-loading-fill page-loading-fill-5" />
        </span>
        <span className="page-loading-box">
          <span className="page-loading-fill page-loading-fill-6" />
        </span>
      </span>
      <span>Loading page…</span>
    </div>
  );
}
