export interface DashboardBreadcrumbItem {
  label: string;
  href?: string;
}

export interface DashboardBreadcrumbProduct {
  productId: string;
  name: string;
}

export interface DashboardBreadcrumbContext {
  organizationId: string;
  organizationName: string;
  products?: readonly DashboardBreadcrumbProduct[];
}

const organizationPages: Record<string, string> = {
  activity: "Activity",
  "api-keys": "API keys",
  people: "Members",
  profile: "Account",
  sessions: "Signed-in devices",
  settings: "Settings",
};

const productPages: Record<string, string> = {
  access: "Permissions",
  activity: "Activity",
  "api-keys": "API keys",
  clients: "App clients",
  people: "Members",
  roles: "Permission sets",
};

const platformAdminPages: Record<string, string> = {
  accounts: "Accounts",
  activity: "Activity history",
  "legacy-access": "Remove older access",
  "organization-requests": "Organization requests",
  "shared-products": "Shared products",
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function pageLabel(segment: string): string {
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildDashboardBreadcrumbs(
  pathname: string,
  context: DashboardBreadcrumbContext,
): DashboardBreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments[0] !== "dashboard") return [];
  if (segments.length === 1) return [{ label: "Set up your organization" }];
  if (segments[1] === "operations") {
    const breadcrumbs: DashboardBreadcrumbItem[] = [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Platform admin", href: "/dashboard/operations" },
    ];
    if (segments.length === 2) {
      breadcrumbs[1] = { label: "Platform admin" };
      return breadcrumbs;
    }
    breadcrumbs.push({ label: platformAdminPages[segments[2]] ?? pageLabel(segments[2]) });
    return breadcrumbs;
  }

  const organizationRoot = `/dashboard/${encodeURIComponent(context.organizationId)}`;
  const organizationName =
    segments[1] === context.organizationId ? context.organizationName : "Organization";

  if (segments[1] === "new-organization") {
    const requestsHref = "/dashboard/new-organization";
    return segments[2] === "new"
      ? [
          { label: context.organizationName, href: organizationRoot },
          { label: "Organization requests", href: requestsHref },
          { label: "Request an organization" },
        ]
      : [
          { label: context.organizationName, href: organizationRoot },
          { label: "Organization requests" },
        ];
  }

  if (segments.length < 3) return [{ label: organizationName }];

  const organizationCrumb: DashboardBreadcrumbItem = {
    label: organizationName,
    href: organizationRoot,
  };
  const section = segments[2];
  if (section === "api-keys" && segments[3] === "new") {
    return [
      organizationCrumb,
      { label: "API keys", href: `${organizationRoot}/api-keys` },
      { label: "Create API key" },
    ];
  }
  if (section === "people" && segments[3] === "invite") {
    return [
      organizationCrumb,
      { label: "Members", href: `${organizationRoot}/people` },
      { label: "Invite member" },
    ];
  }
  if (section === "products") {
    const productsHref = `${organizationRoot}/products`;
    if (segments.length === 3) {
      return [organizationCrumb, { label: "Products" }];
    }
    if (segments[3] === "new") {
      return [
        organizationCrumb,
        { label: "Products", href: productsHref },
        { label: "Create a product" },
      ];
    }

    const productId = segments[3];
    const product = context.products?.find((item) => item.productId === productId);
    const productName = product?.name || productId;
    const productHref = `${productsHref}/${encodeURIComponent(productId)}`;
    const productsCrumb = { label: "Products", href: productsHref };
    if (segments.length === 4) {
      return [organizationCrumb, productsCrumb, { label: productName }];
    }
    if (segments[4] === "clients" && segments[5] === "new") {
      return [
        organizationCrumb,
        productsCrumb,
        { label: productName, href: productHref },
        { label: "App clients", href: `${productHref}/clients` },
        { label: "Create app client" },
      ];
    }
    if (segments[4] === "api-keys" && segments[5] === "new") {
      return [
        organizationCrumb,
        productsCrumb,
        { label: productName, href: productHref },
        { label: "API keys", href: `${productHref}/api-keys` },
        { label: "Create API key" },
      ];
    }
    if (segments[4] === "roles" && segments[5] === "new") {
      return [
        organizationCrumb,
        productsCrumb,
        { label: productName, href: productHref },
        { label: "Permission sets", href: `${productHref}/roles` },
        { label: "Create permission set" },
      ];
    }
    if (segments[4] === "people" && segments[5] === "invite") {
      return [
        organizationCrumb,
        productsCrumb,
        { label: productName, href: productHref },
        { label: "Members", href: `${productHref}/people` },
        { label: "Invite member" },
      ];
    }
    if (segments[4] === "access" && segments[5] === "new") {
      return [
        organizationCrumb,
        productsCrumb,
        { label: productName, href: productHref },
        { label: "Permissions", href: `${productHref}/access` },
        { label: "Assign permissions" },
      ];
    }
    if (segments[4] === "clients" && segments[6] === "edit") {
      return [
        organizationCrumb,
        productsCrumb,
        { label: productName, href: productHref },
        { label: "App clients", href: `${productHref}/clients` },
        { label: "Edit app client" },
      ];
    }
    const page = productPages[segments[4]] ?? pageLabel(segments[4]);
    return [
      organizationCrumb,
      productsCrumb,
      { label: productName, href: productHref },
      { label: page },
    ];
  }

  const page = organizationPages[section] ?? pageLabel(section);
  return [organizationCrumb, { label: page }];
}
