"use client";

import { useId } from "react";

export function ListFilterInput({
  value,
  onChange,
  placeholder = "Filter...",
  ariaLabel = "Filter list",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const inputId = useId();

  return (
    <div className="filter-input-wrapper">
      <input
        id={inputId}
        type="search"
        className="filter-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {value ? (
        <button
          type="button"
          className="filter-clear-button"
          onClick={() => onChange("")}
          aria-label="Clear filter"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
