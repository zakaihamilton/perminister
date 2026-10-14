"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/tooltip";

export function CopyAppClientEnvironmentButton({
  clientId,
  secret,
}: {
  clientId: string;
  secret: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyStateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyStateTimeout.current) clearTimeout(copyStateTimeout.current);
    },
    [],
  );

  async function copyEnvironmentVariables() {
    if (copyStateTimeout.current) {
      clearTimeout(copyStateTimeout.current);
      copyStateTimeout.current = null;
    }
    setCopyState("idle");
    try {
      await navigator.clipboard.writeText(
        `PERMINISTER_APP_CLIENT_ID=${clientId}\nPERMINSITER_APP_CLIENT_SECRET=${secret}`,
      );
      setCopyState("copied");
      copyStateTimeout.current = setTimeout(() => {
        setCopyState("idle");
        copyStateTimeout.current = null;
      }, 1800);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <>
      <Tooltip
        content={
          copyState === "copied"
            ? "Environment variables copied."
            : copyState === "failed"
              ? "Could not copy the environment variables."
              : "Copy the app client environment variables."
        }
        label="Copy environment variables"
        triggerProps={{
          className: "copy-environment-button",
          onClick: copyEnvironmentVariables,
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
        {copyState === "copied" ? "Environment variables copied to clipboard." : ""}
      </span>
      {copyState === "failed" ? (
        <span className="copy-environment-error" role="status">
          Could not copy. You can select and copy the values manually.
        </span>
      ) : null}
    </>
  );
}
