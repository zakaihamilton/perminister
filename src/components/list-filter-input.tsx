"use client";

import { useId } from "react";
import styles from "./list-filter-input.module.css";

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
    <div className={styles.wrapper}>
      <input
        id={inputId}
        type="search"
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {value ? (
        <button
          type="button"
          className={styles.clearButton}
          onClick={() => onChange("")}
          aria-label="Clear filter"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
