// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrganizationCreateProductAction,
  OrganizationProductsSection,
} from "@/components/organization-overview-sections";
import type { ProductRecord } from "@/lib/auth/domain";

const organizationId = "org-123";
const product = {
  kind: "product",
  schemaVersion: 1,
  productRecordId: "record-1",
  organizationId,
  productId: "atlas",
  name: "Atlas",
  description: "A planning app",
  websiteUrl: "https://atlas.example",
  iconUrl: "",
  visibility: "private",
  createdBySubjectId: "subject-1",
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z",
} as ProductRecord;

afterEach(cleanup);

describe("organization overview products", () => {
  it.each(["owner", "admin"] as const)(
    "offers one direct Create product action to an organization %s with existing products",
    (role) => {
      const canManage = role === "owner" || role === "admin";
      const { rerender } = render(
        <OrganizationCreateProductAction
          canManage={canManage}
          hasProducts
          organizationId={organizationId}
        />,
      );

      expect(screen.getByRole("link", { name: "Create product" }).getAttribute("href")).toBe(
        `/dashboard/${organizationId}/products/new`,
      );

      rerender(
        <OrganizationCreateProductAction
          canManage={false}
          hasProducts
          organizationId={organizationId}
        />,
      );
      expect(screen.queryByRole("link", { name: "Create product" })).toBeNull();
    },
  );

  it("puts products first and links to the full catalog", () => {
    render(
      <OrganizationProductsSection
        canManage
        organizationId={organizationId}
        products={[product]}
      />,
    );

    const section = screen.getByRole("heading", { name: "Products" }).closest("section");
    if (!section) throw new Error("Products section was not rendered");
    expect(within(section).getByRole("link", { name: /Atlas/ })).toBeTruthy();
    expect(
      within(section).getByRole("link", { name: "View all products" }).getAttribute("href"),
    ).toBe(`/dashboard/${organizationId}/products`);
    expect(section.textContent).not.toContain("Next steps");
    expect(section.querySelector(".dashboard-metric-grid")).toBeNull();
  });

  it("offers product creation and shared products when an owner or admin has no products", () => {
    render(<OrganizationProductsSection canManage organizationId={organizationId} products={[]} />);

    expect(screen.getByRole("heading", { name: "No products yet" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create product" }).getAttribute("href")).toBe(
      `/dashboard/${organizationId}/products/new`,
    );
    expect(screen.getByRole("link", { name: "Browse shared products" }).getAttribute("href")).toBe(
      `/dashboard/${organizationId}/products#public-product-catalog`,
    );
  });

  it("shows members a simple empty state without management actions", () => {
    render(
      <OrganizationProductsSection
        canManage={false}
        organizationId={organizationId}
        products={[]}
      />,
    );

    expect(screen.getByRole("heading", { name: "No products available" })).toBeTruthy();
    expect(
      screen.getByText("Ask an organization owner or admin to add you to a product."),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Create product" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse shared products" })).toBeNull();
  });
});
