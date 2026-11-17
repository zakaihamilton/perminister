import Link from "next/link";
import { operationsHref } from "@/lib/operations-navigation";

const sections = [
  {
    href: "/dashboard/operations/shared-products",
    title: "Shared products",
    description: "Transfer a shared product’s publisher role to another approved organization.",
  },
  {
    href: "/dashboard/operations/organization-requests",
    title: "Organization requests",
    description: "Review pending requests to create an organization.",
  },
  {
    href: "/dashboard/operations/legacy-access",
    title: "Remove older access",
    description: "Disable permissions and revoke API keys that are not linked to an organization.",
  },
  {
    href: "/dashboard/operations/accounts",
    title: "Accounts",
    description: "View registered accounts and manage their status or access.",
  },
  {
    href: "/dashboard/operations/activity",
    title: "Activity history",
    description: "Review recent changes across Perminister or filter by organization.",
  },
] as const;

export function PlatformAdminSectionLinks({ organizationId }: { organizationId?: string }) {
  return (
    <nav aria-label="Platform admin sections" className="operations-section-nav">
      <ul className="operations-section-links">
        {sections.map((section) => (
          <li key={section.href}>
            <Link
              className="dashboard-card operations-section-link"
              href={operationsHref(section.href, organizationId)}
            >
              <h2>{section.title}</h2>
              <p>{section.description}</p>
              <span className="operations-section-link-action">
                Open section <span aria-hidden="true">→</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
