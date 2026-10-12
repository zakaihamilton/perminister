// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePathname: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname }));

import { DashboardNavigation } from "@/components/dashboard-navigation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Platform admin navigation", () => {
  it.each([
    "/dashboard/operations",
    "/dashboard/operations/shared-products",
    "/dashboard/operations/organization-requests",
    "/dashboard/operations/legacy-access",
    "/dashboard/operations/accounts",
    "/dashboard/operations/activity",
  ])("shows the active Platform admin link at %s", (pathname) => {
    mocks.usePathname.mockReturnValue(pathname);

    render(<DashboardNavigation isPlatformAdministrator pendingOrganizationRequestCount={null} />);

    expect(screen.getByRole("link", { name: "Platform admin" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
});
