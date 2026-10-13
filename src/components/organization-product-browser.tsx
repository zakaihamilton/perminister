"use client";

import Link from "next/link";
import { useState } from "react";
import { ProductIcon } from "@/components/product-icon";
import { Tooltip } from "@/components/tooltip";
import type { ProductRecord } from "@/lib/auth/domain";

type ProductPreview = Pick<
  ProductRecord,
  "productId" | "name" | "description" | "websiteUrl" | "iconUrl"
>;

export function OrganizationProductBrowser({
  canManage,
  organizationId,
  products,
}: {
  canManage: boolean;
  organizationId: string;
  products: ProductPreview[];
}) {
  const [view, setView] = useState<"cards" | "list">("cards");

  return (
    <div className="organization-product-browser">
      <div className="organization-product-browser-toolbar">
        <span>Display</span>
        <div
          aria-label="Product display options"
          className="organization-product-view-controls"
          role="group"
        >
          <Tooltip
            content="Show products as cards"
            triggerProps={{
              "aria-label": "Card view",
              "aria-pressed": view === "cards",
              className: "organization-product-view-button",
              onClick: () => setView("cards"),
            }}
          >
            <GridIcon />
          </Tooltip>
          <Tooltip
            content="Show products as a compact list"
            triggerProps={{
              "aria-label": "List view",
              "aria-pressed": view === "list",
              className: "organization-product-view-button",
              onClick: () => setView("list"),
            }}
          >
            <ListIcon />
          </Tooltip>
        </div>
      </div>
      <div className={`organization-product-preview-grid is-${view}`}>
        {products.map((product) => (
          <Link
            className="organization-product-card"
            href={`/dashboard/${organizationId}/products/${encodeURIComponent(product.productId)}`}
            key={product.productId}
          >
            <span className="organization-product-card-top">
              <ProductIcon
                className="organization-product-icon"
                name={product.name}
                size={44}
                src={product.iconUrl}
              />
              <span className="organization-product-badge">
                {canManage ? "Managed" : "Access granted"}
              </span>
            </span>
            <span className="organization-product-card-copy">
              <strong>{product.name}</strong>
              <span className="organization-product-description">
                {product.description || product.websiteUrl || "Product access and permissions"}
              </span>
              <span className="organization-product-card-action">
                {canManage ? "Manage product" : "View access"}
                <ArrowIcon />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function GridIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <rect height="6" rx="1" width="6" x="3" y="3" />
      <rect height="6" rx="1" width="6" x="11" y="3" />
      <rect height="6" rx="1" width="6" x="3" y="11" />
      <rect height="6" rx="1" width="6" x="11" y="11" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M7 5h10M7 10h10M7 15h10" />
      <circle cx="3.5" cy="5" r=".75" />
      <circle cx="3.5" cy="10" r=".75" />
      <circle cx="3.5" cy="15" r=".75" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M4 10h11M10 5l5 5-5 5" />
    </svg>
  );
}
