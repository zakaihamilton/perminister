"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ListFilterInput } from "@/components/list-filter-input";

export function ClientFilteredList<T>({
  items,
  filterFn,
  renderItem,
  placeholder = "Filter list...",
  ariaLabel = "Filter list",
  emptyMessage = "No matching items found.",
  noItemsMessage = "No items yet.",
}: {
  items: readonly T[];
  filterFn: (item: T, query: string) => boolean;
  renderItem: (item: T) => ReactNode;
  placeholder?: string;
  ariaLabel?: string;
  emptyMessage?: string;
  noItemsMessage?: string;
}) {
  const [filterQuery, setFilterQuery] = useState("");

  const filtered = filterQuery.trim()
    ? items.filter((item) => filterFn(item, filterQuery.trim().toLowerCase()))
    : items;

  return (
    <>
      {items.length > 3 ? (
        <ListFilterInput
          value={filterQuery}
          onChange={setFilterQuery}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
        />
      ) : null}
      {filtered.length === 0 ? (
        <div className="filter-empty-message" role="status">
          {items.length === 0 ? noItemsMessage : emptyMessage}
        </div>
      ) : (
        filtered.map((item) => renderItem(item))
      )}
    </>
  );
}
