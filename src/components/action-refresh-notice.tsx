"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const REFRESH_PARAM = "__perminister_action";

export function ActionRefreshNotice() {
  const noticeRef = useRef<HTMLDivElement>(null);
  const displayedOnPath = useRef<string | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const notice = noticeRef.current;
    if (!notice) return;

    const url = new URL(window.location.href);
    if (searchParams.get(REFRESH_PARAM) === "refresh") {
      displayedOnPath.current = pathname;
      notice.hidden = false;
      url.searchParams.delete(REFRESH_PARAM);
      window.history.replaceState(window.history.state, "", url);
      return;
    }

    if (displayedOnPath.current && displayedOnPath.current !== pathname) {
      notice.hidden = true;
      displayedOnPath.current = null;
    }
  }, [pathname, searchParams]);

  return (
    <div
      className="action-refresh-notice dashboard-notice info"
      hidden
      ref={noticeRef}
      role="status"
      aria-live="polite"
    >
      This page was updated while it was open. Review the page and submit your changes again.
    </div>
  );
}
