"use client";

import { useEffect, useRef, useState } from "react";

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
        <button className="button button-secondary" onClick={copyOrganizationId} type="button">
          {copyState === "copied" ? "Copied" : "Copy ID"}
        </button>
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
