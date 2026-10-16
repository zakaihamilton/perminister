import Link from "next/link";
import { Tooltip } from "@/components/tooltip";
import type { OrganizationRole } from "@/lib/auth/domain";

type OrganizationOverviewMetric = {
  label: string;
  value: string;
  caption: string;
  help: string;
  icon: "products" | "members" | "keys";
  href?: string;
};

export function OrganizationOverviewMetrics({
  activeApiKeyCount,
  memberCount,
  organizationId,
  productCount,
  role,
}: {
  activeApiKeyCount: number;
  memberCount: number | null;
  organizationId: string;
  productCount: number;
  role: OrganizationRole;
}) {
  const metrics: OrganizationOverviewMetric[] = [
    {
      label: "Products",
      value: productCount.toLocaleString(),
      caption: "available to you",
      help: "Products you can open in this organization.",
      icon: "products",
      href: `/dashboard/${organizationId}/products`,
    },
    memberCount === null
      ? {
          label: "Your role",
          value: role[0].toUpperCase() + role.slice(1),
          caption: "organization access",
          help: "Your organization-level access. Product permissions are managed separately.",
          icon: "members",
        }
      : {
          label: "Members",
          value: memberCount.toLocaleString(),
          caption: `active organization member${memberCount === 1 ? "" : "s"}`,
          help: "Active organization memberships. Product-only memberships are not included.",
          icon: "members",
          href: `/dashboard/${organizationId}/people`,
        },
    {
      label: "Keys",
      value: activeApiKeyCount.toLocaleString(),
      caption: "active in this organization",
      help: "Active, unexpired API keys created by your account for this organization.",
      icon: "keys",
      href: `/dashboard/${organizationId}/api-keys`,
    },
  ];

  return (
    <section aria-label="Organization summary" className="organization-overview-metrics">
      {metrics.map((metric) => (
        <article
          className={`organization-overview-stat${metric.href ? " is-clickable" : ""}`}
          key={metric.label}
        >
          {metric.href ? (
            <Link className="organization-overview-stat-link" href={metric.href}>
              <OrganizationOverviewMetricContent metric={metric} />
            </Link>
          ) : (
            <div className="organization-overview-stat-link">
              <OrganizationOverviewMetricContent metric={metric} />
            </div>
          )}
          <Tooltip
            content={metric.help}
            label={`${metric.label} details`}
            triggerProps={{ className: "tooltip-trigger organization-overview-info" }}
          />
        </article>
      ))}
    </section>
  );
}

function OrganizationOverviewMetricContent({ metric }: { metric: OrganizationOverviewMetric }) {
  return (
    <>
      <div className="organization-overview-stat-heading">
        <MetricIcon icon={metric.icon} />
        <span className="organization-overview-stat-label">{metric.label}</span>
      </div>
      <strong className="organization-overview-stat-value">{metric.value}</strong>
      <span className="organization-overview-stat-caption">{metric.caption}</span>
    </>
  );
}

function MetricIcon({ icon }: { icon: "products" | "members" | "keys" }) {
  return (
    <span className={`organization-overview-stat-icon is-${icon}`} aria-hidden="true">
      {icon === "products" ? <ProductsMetricIcon /> : null}
      {icon === "members" ? <MembersMetricIcon /> : null}
      {icon === "keys" ? <KeysMetricIcon /> : null}
    </span>
  );
}

function ProductsMetricIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="m12 3 8 4.4v9.2L12 21l-8-4.4V7.4L12 3Z" />
      <path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v8.5" />
    </svg>
  );
}

function MembersMetricIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.3a5.5 5.5 0 0 1 11 0V20h-11ZM16 5.5a3 3 0 0 1 0 5.8M17 14.5a4.7 4.7 0 0 1 3.5 4.6v.9" />
    </svg>
  );
}

function KeysMetricIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2" />
    </svg>
  );
}
