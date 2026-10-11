import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "@/components/activity-feed";
import { ActivityPagination } from "@/components/activity-pagination";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  isAdministrator: vi.fn(),
  listPlatformAudit: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("@/lib/auth/service", () => ({
  getCurrentSession: mocks.getCurrentSession,
  isAdministrator: mocks.isAdministrator,
  listPlatformAudit: mocks.listPlatformAudit,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import PlatformActivityPage from "@/app/dashboard/operations/activity/page";

const subjectId = "33333333-3333-4333-8333-333333333333";

describe("platform activity pagination controls", () => {
  it("shows organization and user context for platform events", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityFeed, {
        entries: [
          {
            eventId: "eeeeeeee-eeee-4eee-8eee-ffffffffffff" as never,
            type: "organization.member-disabled",
            occurredAt: "2026-10-10T10:00:00.000Z",
            actor: "admin@example.com",
            aggregateKind: "organization",
            organization: "Northstar",
            user: "Member Example (member@example.com)",
            details: "Atlas transferred from Old Org to Northstar",
          },
        ],
        emptyMessage: "Platform events will appear here.",
        showPlatformContext: true,
        title: "Historical activity",
        description: "Recent events across Perminister.",
      }),
    );

    expect(markup).toContain("Historical activity");
    expect(markup).toContain("Recent events across Perminister.");
    expect(markup).toContain("Organization: Northstar");
    expect(markup).toContain("User: Member Example (member@example.com)");
    expect(markup).toContain("Atlas transferred from Old Org to Northstar");
    expect(markup).toContain("Actor: admin@example.com");
  });

  it("renders numbered navigation with current-page semantics and first/last controls", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityPagination, {
        page: 2,
        totalPages: 4,
        hrefBase: "/dashboard/operations/activity",
      }),
    );

    expect(markup).toContain('aria-label="Historical activity pages"');
    expect(markup).toContain("Page 2 of 4");
    expect(markup).toContain('href="/dashboard/operations/activity?page=1"');
    expect(markup).toContain('href="/dashboard/operations/activity?page=3"');
    expect(markup).toContain('href="/dashboard/operations/activity?page=4"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Page 2"');
  });

  it("disables First and Previous on the first page, and Next and Last on the last page", () => {
    const firstPage = renderToStaticMarkup(
      createElement(ActivityPagination, {
        page: 1,
        totalPages: 4,
        hrefBase: "/dashboard/operations/activity",
      }),
    );
    const lastPage = renderToStaticMarkup(
      createElement(ActivityPagination, {
        page: 4,
        totalPages: 4,
        hrefBase: "/dashboard/operations/activity",
      }),
    );

    expect(firstPage).toMatch(/<button[^>]*disabled=""[^>]*>First<\/button>/);
    expect(firstPage).toMatch(/<button[^>]*disabled=""[^>]*>Previous<\/button>/);
    expect(lastPage).toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
    expect(lastPage).toMatch(/<button[^>]*disabled=""[^>]*>Last<\/button>/);
  });

  it.each([0, 1])("omits navigation with %i pages", (totalPages) => {
    expect(
      renderToStaticMarkup(
        createElement(ActivityPagination, {
          page: 1,
          totalPages,
          hrefBase: "/dashboard/operations/activity",
        }),
      ),
    ).toBe("");
  });
});

describe("platform activity page access and query handling", () => {
  beforeEach(() => {
    mocks.getCurrentSession.mockReset();
    mocks.isAdministrator.mockReset();
    mocks.listPlatformAudit.mockReset();
    mocks.redirect.mockClear();
    mocks.listPlatformAudit.mockResolvedValue({
      entries: [],
      page: 1,
      pageSize: 25,
      totalItems: 0,
      totalPages: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated visitors to login", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);

    await expect(PlatformActivityPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect:/login",
    );
    expect(mocks.listPlatformAudit).not.toHaveBeenCalled();
  });

  it("redirects authenticated non-administrators to the dashboard", async () => {
    mocks.getCurrentSession.mockResolvedValue({ subject: { subjectId } });
    mocks.isAdministrator.mockReturnValue(false);

    await expect(PlatformActivityPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect:/dashboard",
    );
    expect(mocks.listPlatformAudit).not.toHaveBeenCalled();
  });

  const pageParameterCases: [string, string | string[] | undefined, number][] = [
    ["missing", undefined, 1],
    ["malformed", "first", 1],
    ["zero", "0", 1],
    ["negative", "-2", 1],
    ["repeated", ["2", "3"], 1],
    ["valid", "3", 3],
    ["above the final page", "999", 999],
  ];

  it.each(pageParameterCases)("handles %s page parameters", async (_label, value, expectedPage) => {
    mocks.getCurrentSession.mockResolvedValue({ subject: { subjectId } });
    mocks.isAdministrator.mockReturnValue(true);

    await PlatformActivityPage({ searchParams: Promise.resolve({ page: value }) });

    expect(mocks.listPlatformAudit).toHaveBeenCalledWith(subjectId, expectedPage);
  });
});
