import Link from "next/link";

function PaginationControl({
  href,
  label,
  disabled,
}: {
  href: string;
  label: string;
  disabled: boolean;
}) {
  return disabled ? (
    <button className="button button-secondary" type="button" disabled>
      {label}
    </button>
  ) : (
    <Link className="button button-secondary" href={href}>
      {label}
    </Link>
  );
}

export function ActivityPagination({
  page,
  totalPages,
  hrefBase,
}: {
  page: number;
  totalPages: number;
  hrefBase: string;
}) {
  if (totalPages <= 1) return null;

  const pageHref = (targetPage: number) => `${hrefBase}?page=${targetPage}`;

  return (
    <nav className="activity-pagination" aria-label="Activity history pages">
      <span className="activity-pagination-summary">
        Page {page} of {totalPages}
      </span>
      <div className="activity-pagination-controls">
        <PaginationControl href={pageHref(1)} label="First" disabled={page === 1} />
        <PaginationControl href={pageHref(page - 1)} label="Previous" disabled={page === 1} />
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) =>
          pageNumber === page ? (
            <span
              aria-current="page"
              aria-label={`Page ${pageNumber}`}
              className="button button-secondary activity-pagination-current"
              key={pageNumber}
            >
              {pageNumber}
            </span>
          ) : (
            <Link
              aria-label={`Page ${pageNumber}`}
              className="button button-secondary"
              href={pageHref(pageNumber)}
              key={pageNumber}
            >
              {pageNumber}
            </Link>
          ),
        )}
        <PaginationControl href={pageHref(page + 1)} label="Next" disabled={page === totalPages} />
        <PaginationControl
          href={pageHref(totalPages)}
          label="Last"
          disabled={page === totalPages}
        />
      </div>
    </nav>
  );
}
