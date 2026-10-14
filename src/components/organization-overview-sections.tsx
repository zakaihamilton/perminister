import Link from "next/link";
import { Tooltip } from "@/components/tooltip";
import { OrganizationProductBrowser } from "@/components/organization-product-browser";
import type { OrganizationActivityEntry } from "@/lib/auth/service";
import type { OrganizationRole, ProductRecord } from "@/lib/auth/domain";

type OrganizationOverviewMetric = {
  label: string;
  value: string;
  caption: string;
  help: string;
  icon: "products" | "members" | "keys";
  href?: string;
};

export function OrganizationCreateProductAction({
  canManage,
  hasProducts,
  organizationId,
}: {
  canManage: boolean;
  hasProducts: boolean;
  organizationId: string;
}) {
  if (!canManage || !hasProducts) return null;

  return (
    <Link className="button button-primary" href={`/dashboard/${organizationId}/products/new`}>
      Create product
    </Link>
  );
}

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
              <div className="organization-overview-stat-heading">
                <MetricIcon icon={metric.icon} />
                <span className="organization-overview-stat-label">{metric.label}</span>
              </div>
              <strong className="organization-overview-stat-value">{metric.value}</strong>
              <span className="organization-overview-stat-caption">{metric.caption}</span>
            </Link>
          ) : (
            <div className="organization-overview-stat-link">
              <div className="organization-overview-stat-heading">
                <MetricIcon icon={metric.icon} />
                <span className="organization-overview-stat-label">{metric.label}</span>
              </div>
              <strong className="organization-overview-stat-value">{metric.value}</strong>
              <span className="organization-overview-stat-caption">{metric.caption}</span>
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

export function OrganizationProductsSection({
  canManage,
  organizationId,
  products,
}: {
  canManage: boolean;
  organizationId: string;
  products: ProductRecord[];
}) {
  if (products.length) {
    return (
      <section className="dashboard-card dashboard-overview-products">
        <div className="dashboard-card-heading">
          <div>
            <h2>Products</h2>
            <p>
              {canManage
                ? "Open a product to manage its members and permissions."
                : "Open a product to see its details and your permissions."}
            </p>
          </div>
          <Link className="text-link" href={`/dashboard/${organizationId}/products`}>
            View all products
          </Link>
        </div>
        <OrganizationProductBrowser
          canManage={canManage}
          organizationId={organizationId}
          products={products
            .slice(0, 6)
            .map(({ productId, name, description, websiteUrl, iconUrl }) => ({
              productId,
              name,
              description,
              websiteUrl,
              iconUrl,
            }))}
        />
      </section>
    );
  }

  return (
    <section className="dashboard-empty-card organization-products-empty">
      <div>
        <h2>{canManage ? "No products yet" : "No products available"}</h2>
        <p>
          {canManage
            ? "Create a product or add one from the shared catalog. Each product has its own members and permissions."
            : "Ask an organization owner or admin to add you to a product."}
        </p>
      </div>
      {canManage ? (
        <div className="organization-empty-actions">
          <Link
            className="button button-primary"
            href={`/dashboard/${organizationId}/products/new`}
          >
            Create product
          </Link>
          <Link
            className="button button-secondary"
            href={`/dashboard/${organizationId}/products#public-product-catalog`}
          >
            Browse shared products
          </Link>
        </div>
      ) : null}
    </section>
  );
}

export function OrganizationActivityPreview({
  entries,
  organizationId,
}: {
  entries: OrganizationActivityEntry[];
  organizationId: string;
}) {
  return (
    <section className="dashboard-card organization-activity-preview">
      <div className="dashboard-card-heading organization-activity-heading">
        <div>
          <h2>Recent activity</h2>
          <p>Changes to members, products, access, and API keys.</p>
        </div>
        <Link className="text-link" href={`/dashboard/${organizationId}/activity`}>
          View all
        </Link>
      </div>
      {entries.length ? (
        <ol className="organization-activity-list">
          {entries.slice(0, 4).map((entry) => (
            <li className="organization-activity-item" key={entry.eventId}>
              <span className="organization-activity-marker" aria-hidden="true" />
              <div>
                <p>
                  <strong>{entry.actor}</strong> {lowercaseFirst(entry.summary)}.
                </p>
                <time
                  dateTime={entry.occurredAt}
                  title={new Date(entry.occurredAt).toLocaleString()}
                >
                  {new Intl.DateTimeFormat("en", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(entry.occurredAt))}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="organization-activity-empty">
          <span className="organization-activity-empty-icon" aria-hidden="true">
            <ActivityMetricIcon />
          </span>
          <strong>No activity yet</strong>
          <p>Organization changes will appear here.</p>
        </div>
      )}
    </section>
  );
}

function lowercaseFirst(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function ActivityMetricIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />
    </svg>
  );
}
