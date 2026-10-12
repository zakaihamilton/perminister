// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePathname: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname }));

import { DashboardNavigation } from "@/components/dashboard-navigation";
import { ProductNavigation } from "@/components/product-navigation";

const organizationId = "org-123";
const baseDashboardProps = {
  organizationId,
  isPlatformAdministrator: false,
  pendingOrganizationRequestCount: null,
};
const ownerRole = { role: "owner" as const };
const memberRole = { role: "member" as const };
const adminProductRole = { role: "admin" as const };

beforeEach(() => {
  mocks.usePathname.mockReturnValue(`/dashboard/${organizationId}`);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("organization navigation", () => {
  it.each([
    ["owner", ["Overview", "Products", "API keys", "Members", "Activity", "Organization settings"]],
    ["admin", ["Overview", "Products", "API keys", "Members", "Activity"]],
    ["member", ["Overview", "Products", "API keys"]],
  ] as const)("shows the right organization links for %s", (role, expectedLinks) => {
    render(<DashboardNavigation {...baseDashboardProps} role={role} />);

    const navigation = screen.getByRole("navigation", { name: "Dashboard pages" });
    expect(navigation.querySelector(".dashboard-nav-label")?.textContent).toBe("Organization");
    for (const label of expectedLinks) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Account" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Manage signed-in devices" })).toBeNull();
  });

  it("shows Platform admin only to platform administrators and marks it active", () => {
    mocks.usePathname.mockReturnValue("/dashboard/operations");
    const { rerender } = render(<DashboardNavigation {...baseDashboardProps} {...ownerRole} />);
    expect(screen.queryByRole("link", { name: "Platform admin" })).toBeNull();

    rerender(
      <DashboardNavigation
        {...baseDashboardProps}
        {...ownerRole}
        isPlatformAdministrator
        pendingOrganizationRequestCount={2}
      />,
    );
    expect(
      screen
        .getByRole("link", {
          name: "Platform admin, 2 organization requests to review",
        })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("marks the single Account link active on the account and device pages", () => {
    mocks.usePathname.mockReturnValue(`/dashboard/${organizationId}/profile`);
    const { rerender } = render(<DashboardNavigation {...baseDashboardProps} {...memberRole} />);
    expect(screen.getByRole("link", { name: "Account" }).getAttribute("aria-current")).toBe("page");

    mocks.usePathname.mockReturnValue(`/dashboard/${organizationId}/sessions`);
    rerender(<DashboardNavigation {...baseDashboardProps} {...memberRole} />);
    expect(screen.getByRole("link", { name: "Account" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByRole("link", { name: "Account" })).toHaveLength(1);
  });
});

describe("product navigation", () => {
  const productProps = {
    organizationId,
    productId: "atlas",
    productName: "Atlas",
    isSharedInstallation: false,
  };

  it.each(["owner", "admin"] as const)("shows all product pages to a product %s", (role) => {
    mocks.usePathname.mockReturnValue(`/dashboard/${organizationId}/products/atlas/access`);
    render(<ProductNavigation {...productProps} role={role} />);

    const navigation = screen.getByRole("navigation", { name: "Atlas pages" });
    for (const label of [
      "Members",
      "Permissions",
      "Permission sets",
      "App clients",
      "API keys",
      "Activity",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Permissions" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(navigation.querySelectorAll("a")).toHaveLength(6);
  });

  it("limits product members to the pages they can access", () => {
    render(<ProductNavigation {...productProps} {...memberRole} />);

    expect(screen.getByRole("link", { name: "Permissions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "API keys" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Activity" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
    expect(screen.queryByRole("link", { name: "App clients" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Permission sets" })).toBeNull();
  });

  it("hides publisher-owned permission sets for a shared product", () => {
    render(<ProductNavigation {...productProps} isSharedInstallation {...adminProductRole} />);

    expect(screen.queryByRole("link", { name: "Permission sets" })).toBeNull();
    expect(screen.getByRole("link", { name: "Permissions" })).toBeTruthy();
  });

  it("does not render product links when the person has no product role", () => {
    const { container } = render(<ProductNavigation {...productProps} />);

    expect(container.querySelector("nav")).toBeNull();
  });

  it("keeps tabs keyboard accessible", async () => {
    const user = userEvent.setup();
    render(<ProductNavigation {...productProps} {...memberRole} />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Permissions" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "API keys" }));
  });
});
