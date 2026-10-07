import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BreadcrumbBar } from "../src/components/dashboard-breadcrumbs";
import { buildDashboardBreadcrumbs } from "../src/lib/dashboard-breadcrumbs";

const context = {
  organizationId: "org-123",
  organizationName: "Sentry8",
  products: [{ productId: "visitoring", name: "Visitoring" }],
};

describe("dashboard breadcrumbs", () => {
  it.each([
    ["/dashboard", [{ label: "Set up your workspace" }]],
    ["/dashboard/org-123", [{ label: "Sentry8" }]],
    [
      "/dashboard/org-123/products",
      [{ label: "Sentry8", href: "/dashboard/org-123" }, { label: "Products" }],
    ],
    [
      "/dashboard/org-123/products/new",
      [
        { label: "Sentry8", href: "/dashboard/org-123" },
        { label: "Products", href: "/dashboard/org-123/products" },
        { label: "Create a product" },
      ],
    ],
    [
      "/dashboard/org-123/products/visitoring",
      [
        { label: "Sentry8", href: "/dashboard/org-123" },
        { label: "Products", href: "/dashboard/org-123/products" },
        { label: "Visitoring" },
      ],
    ],
    [
      "/dashboard/org-123/products/visitoring/roles",
      [
        { label: "Sentry8", href: "/dashboard/org-123" },
        { label: "Products", href: "/dashboard/org-123/products" },
        { label: "Visitoring", href: "/dashboard/org-123/products/visitoring" },
        { label: "Access roles" },
      ],
    ],
    [
      "/dashboard/org-123/settings",
      [{ label: "Sentry8", href: "/dashboard/org-123" }, { label: "Settings" }],
    ],
    [
      "/dashboard/new-organization",
      [{ label: "Sentry8", href: "/dashboard/org-123" }, { label: "Request an organization" }],
    ],
    [
      "/dashboard/operations",
      [{ label: "Dashboard", href: "/dashboard" }, { label: "Platform operations" }],
    ],
  ] as const)("maps %s to its hierarchy", (pathname, expected) => {
    expect(buildDashboardBreadcrumbs(pathname, context)).toEqual(expected);
  });

  it("uses the product ID when its readable name is unavailable", () => {
    expect(
      buildDashboardBreadcrumbs("/dashboard/org-123/products/unknown-product", {
        ...context,
        products: [],
      }).at(-1),
    ).toEqual({ label: "unknown-product" });
  });

  it("renders linked ancestors and a non-link current page accessibly", () => {
    const items = buildDashboardBreadcrumbs(
      "/dashboard/org-123/products/visitoring/roles",
      context,
    );
    const html = renderToStaticMarkup(createElement(BreadcrumbBar, { items }));

    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain('href="/dashboard/org-123/products/visitoring"');
    expect(html).toContain(
      '<span aria-current="page" class="dashboard-breadcrumb-current">Access roles</span>',
    );
    expect(html).toContain('<h1 class="dashboard-page-title">Access roles</h1>');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<a href="/dashboard/org-123/products/visitoring/roles">');
  });
});
