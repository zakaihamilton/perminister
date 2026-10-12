import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  isAdministrator: vi.fn(),
  listAccountsForAdministrator: vi.fn(),
  listPendingOrganizationsForAdministrator: vi.fn(),
  listPublicProductsForAdministrator: vi.fn(),
  previewLegacyAccessRetirement: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/service", () => ({
  getCurrentSession: mocks.getCurrentSession,
  isAdministrator: mocks.isAdministrator,
  listAccountsForAdministrator: mocks.listAccountsForAdministrator,
  listPendingOrganizationsForAdministrator: mocks.listPendingOrganizationsForAdministrator,
  listPublicProductsForAdministrator: mocks.listPublicProductsForAdministrator,
  previewLegacyAccessRetirement: mocks.previewLegacyAccessRetirement,
}));
vi.mock("@/components/dashboard-shell", () => ({
  DashboardHeading: ({ description }: { description: string }) => <header>{description}</header>,
}));
vi.mock("@/components/operations-shell", () => ({
  OperationsShell: ({
    breadcrumbs,
    children,
  }: {
    breadcrumbs: Array<{ label: string }>;
    children: ReactNode;
  }) => (
    <main>
      <nav aria-label="Breadcrumbs">{breadcrumbs.map((item) => item.label).join(" / ")}</nav>
      {children}
    </main>
  ),
}));
vi.mock("@/components/operations-sections", () => ({
  AccountsSection: ({ accounts }: { accounts: unknown[] }) => (
    <section data-section="accounts">Accounts section: {accounts.length}</section>
  ),
  LegacyAccessSection: ({ legacy }: { legacy: { grants: number; keys: number } }) => (
    <section data-section="legacy-access">
      Legacy access section: {legacy.grants} grants, {legacy.keys} keys
    </section>
  ),
  OperationsFeedback: ({ query }: { query: { error?: string; notice?: string } }) => (
    <div data-feedback>{query.notice ?? query.error}</div>
  ),
  OrganizationRequestsSection: ({ organizations }: { organizations: unknown[] }) => (
    <section data-section="organization-requests">
      Organization requests section: {organizations.length}
    </section>
  ),
  PublicProductsSection: ({ products }: { products: unknown[] }) => (
    <section data-section="shared-products">Shared products section: {products.length}</section>
  ),
}));

import OperationsPage from "@/app/dashboard/operations/page";
import PlatformAccountsPage from "@/app/dashboard/operations/accounts/page";
import LegacyAccessPage from "@/app/dashboard/operations/legacy-access/page";
import OrganizationRequestsPage from "@/app/dashboard/operations/organization-requests/page";
import SharedProductsPage from "@/app/dashboard/operations/shared-products/page";

const subjectId = "33333333-3333-4333-8333-333333333333";
const searchParams = Promise.resolve({});

const sectionPages = [
  {
    title: "Shared products",
    render: () => SharedProductsPage({ searchParams }),
    loader: mocks.listPublicProductsForAdministrator,
    marker: 'data-section="shared-products"',
  },
  {
    title: "Organization requests",
    render: () => OrganizationRequestsPage({ searchParams }),
    loader: mocks.listPendingOrganizationsForAdministrator,
    marker: 'data-section="organization-requests"',
  },
  {
    title: "Remove older access",
    render: () => LegacyAccessPage({ searchParams }),
    loader: mocks.previewLegacyAccessRetirement,
    marker: 'data-section="legacy-access"',
  },
  {
    title: "Accounts",
    render: () => PlatformAccountsPage({ searchParams }),
    loader: mocks.listAccountsForAdministrator,
    marker: 'data-section="accounts"',
  },
] as const;

describe("platform admin pages", () => {
  beforeEach(() => {
    mocks.getCurrentSession.mockResolvedValue({ subject: { subjectId } });
    mocks.isAdministrator.mockReturnValue(true);
    mocks.listAccountsForAdministrator.mockResolvedValue([]);
    mocks.listPendingOrganizationsForAdministrator.mockResolvedValue([]);
    mocks.listPublicProductsForAdministrator.mockResolvedValue([]);
    mocks.previewLegacyAccessRetirement.mockResolvedValue({ grants: 0, keys: 0 });
  });

  it("lists every section and activity history from the landing page", async () => {
    const markup = renderToStaticMarkup(await OperationsPage());

    expect(markup).toContain('aria-label="Platform admin sections"');
    for (const [href, title] of [
      ["/dashboard/operations/shared-products", "Shared products"],
      ["/dashboard/operations/organization-requests", "Organization requests"],
      ["/dashboard/operations/legacy-access", "Remove older access"],
      ["/dashboard/operations/accounts", "Accounts"],
      ["/dashboard/operations/activity", "Activity history"],
    ]) {
      expect(markup).toContain(`href="${href}"`);
      expect(markup).toContain(title);
    }
    expect(markup).not.toContain("data-section=");
  });

  it.each(sectionPages)(
    "loads and renders $title on its own page",
    async ({ title, render, loader, marker }) => {
      const markup = renderToStaticMarkup(await render());

      expect(markup).toContain(title);
      expect(markup).toContain(marker);
      expect(loader).toHaveBeenCalledWith(subjectId);
    },
  );

  it.each(sectionPages)("requires platform administrator access for $title", async ({ render }) => {
    mocks.isAdministrator.mockReturnValue(false);

    await expect(render()).rejects.toThrow("redirect:/dashboard");
  });
});
