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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows organization and user context for platform events", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityFeed, {
        entries: [
          {
            eventId: "eeeeeeee-eeee-4eee-8eee-ffffffffffff" as never,
            type: "organization.member-disabled",
            summary: "Removed an organization member",
            occurredAt: "2026-10-10T10:00:00.000Z",
            actor: "admin@example.com",
            aggregateKind: "organization",
            target: "Member Example (member@example.com)",
            affectedUser: "Member Example (member@example.com)",
            organization: "Northstar",
            user: "Member Example (member@example.com)",
            actorIsUser: false,
            details: [
              { label: "Event type", value: "organization.member-disabled" },
              { label: "Transfer", value: "Atlas transferred from Old Org to Northstar" },
            ],
          },
        ],
        emptyMessage: "Platform events will appear here.",
        showPlatformContext: true,
        title: "Activity history",
        description: "Recent events across Perminister.",
      }),
    );

    expect(markup).toContain("Activity history");
    expect(markup).toContain("Recent events across Perminister.");
    expect(markup).toContain("Organization: Northstar");
    expect(markup).toContain("User:");
    expect(markup).toContain("Member Example (member@example.com)");
    expect(markup).toContain('class="activity-item"');
    expect(markup).toContain("<strong>admin@example.com</strong> removed an organization member.");
    expect(markup).toContain("Atlas transferred from Old Org to Northstar");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
    expect(markup).not.toContain("organization.member-disabled");
    expect(markup).toContain("2 days ago");
    expect(markup).toContain(new Date("2026-10-10T10:00:00.000Z").toLocaleString());
  });

  it("does not repeat the person when they are the platform actor and target", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityFeed, {
        entries: [
          {
            eventId: "eeeeeeee-eeee-4eee-8eee-ffffffffffff" as never,
            type: "session.created",
            summary: "Signed in",
            occurredAt: "2026-10-12T09:55:00.000Z",
            actor: "Member Example",
            aggregateKind: "session",
            target: "Member Example",
            affectedUser: "Member Example",
            organization: "Northstar",
            user: "Member Example",
            actorIsUser: true,
            details: [],
          },
        ],
        emptyMessage: "Platform events will appear here.",
        showPlatformContext: true,
      }),
    );

    expect(markup).toContain("<strong>Member Example</strong> signed in.");
    expect(markup).toContain("Organization: Northstar");
    expect(markup).not.toContain("User:");
    expect(markup).not.toContain("Person:");
    expect(markup).not.toContain("Target:");
  });

  it("renders recorded before-and-after fields directly in the card", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityFeed, {
        entries: [
          {
            eventId: "eeeeeeee-eeee-4eee-8eee-ffffffffffff" as never,
            type: "organization.member-role-updated",
            summary: "Changed an organization member role",
            occurredAt: "2026-10-10T10:00:00.000Z",
            actor: "Admin Example",
            aggregateKind: "organization-membership",
            target: "Member Example",
            affectedUser: "Member Example",
            details: [
              { label: "Event type", value: "organization.member-role-updated" },
              { label: "Role", before: "member", after: "admin" },
            ],
          },
        ],
        emptyMessage: "Organization events will appear here.",
      }),
    );

    expect(markup).toContain("<strong>Admin Example</strong> changed an organization member role.");
    expect(markup).toContain("Person");
    expect(markup).not.toContain("organization.member-role-updated");
    expect(markup).toContain("Role");
    expect(markup).toContain('member <span aria-hidden="true">→</span> admin');
  });

  it("keeps older event details visible without suggesting an unrecorded change", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityFeed, {
        entries: [
          {
            eventId: "eeeeeeee-eeee-4eee-8eee-ffffffffffff" as never,
            type: "api-key.created",
            summary: "Created an API key",
            occurredAt: "2026-10-12T09:55:00.000Z",
            actor: "Admin Example",
            aggregateKind: "api-key",
            target: "API key",
            affectedUser: null,
            details: [{ label: "Key type", value: "integration" }],
          },
        ],
        emptyMessage: "Organization events will appear here.",
      }),
    );

    expect(markup).toContain("Key type: </span>integration");
    expect(markup).not.toContain("→");
  });

  it("shows readable invitation and API-key details without raw event types", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityFeed, {
        entries: [
          {
            eventId: "eeeeeeee-eeee-4eee-8eee-fffffffffff1" as never,
            type: "product.invitation-created",
            summary: "Invited a product member",
            occurredAt: "2026-10-12T09:55:00.000Z",
            actor: "Admin Example",
            aggregateKind: "organization-invitation",
            target: "Product invitation",
            affectedUser: null,
            details: [
              { label: "Event type", value: "product.invitation-created" },
              { label: "Invitation role", value: "member" },
              { label: "Invitation expires", value: "October 20, 2026" },
            ],
          },
          {
            eventId: "eeeeeeee-eeee-4eee-8eee-fffffffffff2" as never,
            type: "api-key.created",
            summary: "Created an integration API key",
            occurredAt: "2026-10-12T09:50:00.000Z",
            actor: "Admin Example",
            aggregateKind: "api-key",
            target: "integration API key",
            affectedUser: null,
            details: [
              { label: "Event type", value: "api-key.created" },
              { label: "Key type", value: "integration" },
              { label: "Allowed actions", before: "None", after: "project.read" },
            ],
          },
        ],
        emptyMessage: "Organization events will appear here.",
      }),
    );

    expect(markup).toContain("<strong>Admin Example</strong> invited a product member.");
    expect(markup).toContain("Invitation role: </span>member");
    expect(markup).toContain("Invitation expires: </span>October 20, 2026");
    expect(markup).toContain("<strong>Admin Example</strong> created an integration API key.");
    expect(markup).toContain("Key type: </span>integration");
    expect(markup).toContain(
      'Allowed actions: </span>None <span aria-hidden="true">→</span> project.read',
    );
    expect(markup).not.toContain("product.invitation-created");
    expect(markup).not.toContain("api-key.created");
  });

  it("renders numbered navigation with current-page semantics and first/last controls", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityPagination, {
        page: 2,
        totalPages: 4,
        hrefBase: "/dashboard/operations/activity",
      }),
    );

    expect(markup).toContain('aria-label="Activity history pages"');
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
