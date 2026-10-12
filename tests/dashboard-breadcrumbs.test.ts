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
    ["/dashboard", [{ label: "Set up your organization" }]],
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
        { label: "Permission sets" },
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
      [{ label: "Dashboard", href: "/dashboard" }, { label: "Platform admin" }],
    ],
    [
      "/dashboard/org-123/profile",
      [{ label: "Sentry8", href: "/dashboard/org-123" }, { label: "Account" }],
    ],
    [
      "/dashboard/org-123/sessions",
      [{ label: "Sentry8", href: "/dashboard/org-123" }, { label: "Signed-in devices" }],
    ],
    [
      "/dashboard/org-123/products/visitoring/clients",
      [
        { label: "Sentry8", href: "/dashboard/org-123" },
        { label: "Products", href: "/dashboard/org-123/products" },
        { label: "Visitoring", href: "/dashboard/org-123/products/visitoring" },
        { label: "App clients" },
      ],
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

  it("renders linked ancestors without repeating the current page in the breadcrumb", () => {
    const items = buildDashboardBreadcrumbs(
      "/dashboard/org-123/products/visitoring/roles",
      context,
    );
    const html = renderToStaticMarkup(createElement(BreadcrumbBar, { items }));

    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain('href="/dashboard/org-123/products/visitoring"');
    expect(html).toContain('<h1 class="dashboard-page-title">Permission sets</h1>');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('aria-current="page"');
    expect(html.match(/Permission sets/g)).toHaveLength(1);
    expect(html).not.toContain('<a href="/dashboard/org-123/products/visitoring/roles">');
  });

  it("omits an empty breadcrumb when the current page has no ancestors", () => {
    const html = renderToStaticMarkup(
      createElement(BreadcrumbBar, { items: [{ label: "Set up your organization" }] }),
    );

    expect(html).not.toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain('<h1 class="dashboard-page-title">Set up your organization</h1>');
  });
});
