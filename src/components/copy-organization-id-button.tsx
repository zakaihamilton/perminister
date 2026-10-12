"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/tooltip";

export function CopyOrganizationIdButton({ organizationId }: { organizationId: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyStateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const organizationIdField = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (copyStateTimeout.current) clearTimeout(copyStateTimeout.current);
    },
    [],
  );

  async function copyOrganizationId() {
    if (copyStateTimeout.current) {
      clearTimeout(copyStateTimeout.current);
      copyStateTimeout.current = null;
    }
    setCopyState("idle");
    try {
      await navigator.clipboard.writeText(organizationId);
      setCopyState("copied");
      copyStateTimeout.current = setTimeout(() => {
        setCopyState("idle");
        copyStateTimeout.current = null;
      }, 1800);
    } catch {
      setCopyState("failed");
      organizationIdField.current?.focus();
    }
  }

  return (
    <div className="organization-id-copy">
      <input
        ref={organizationIdField}
        aria-label="Organization ID"
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        type="text"
        value={organizationId}
      />
      <div className="organization-id-copy-action">
        <Tooltip
          content={
            copyState === "copied"
              ? "Organization ID copied."
              : "Copy this organization ID to your clipboard."
          }
          label="Copy organization ID"
          triggerProps={{
            className: "organization-id-copy-button",
            onClick: copyOrganizationId,
          }}
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
            <rect
              height="11"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              width="11"
              x="7"
              y="7"
            />
            <path
              d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </Tooltip>
        <span className="visually-hidden" aria-live="polite">
          {copyState === "copied" ? "Organization ID copied to clipboard." : ""}
        </span>
        {copyState === "failed" ? (
          <span className="organization-id-copy-error" role="status">
            Could not copy. The ID is selected; copy it manually.
          </span>
        ) : null}
      </div>
    </div>
  );
}
