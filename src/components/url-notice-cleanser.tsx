"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const NOTICE_KEYS = ["notice", "error", "message"];

export function UrlNoticeCleanser() {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let hasNoticeParam = false;
    for (const key of NOTICE_KEYS) {
      if (searchParams.has(key)) {
        hasNoticeParam = true;
        break;
      }
    }

    if (!hasNoticeParam) return;

    // Wait a brief moment after hydration so screen readers and visual layout settle
    const timeout = window.setTimeout(() => {
      const url = new URL(window.location.href);
      let changed = false;
      for (const key of NOTICE_KEYS) {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      }
      if (changed) {
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + (url.search ? url.search : "") + url.hash,
        );
      }
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [searchParams]);

  return null;
}
