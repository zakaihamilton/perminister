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
  people: "Catalog managers",
  profile: "Profile",
  sessions: "Sessions",
  settings: "Settings",
};

const productPages: Record<string, string> = {
  access: "Access",
  activity: "Activity",
  "api-keys": "API keys",
  people: "People",
  roles: "Access roles",
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
  if (segments.length === 1) return [{ label: "Set up your workspace" }];
  if (segments[1] === "operations") {
    return [{ label: "Dashboard", href: "/dashboard" }, { label: "Platform operations" }];
  }

  const organizationRoot = `/dashboard/${encodeURIComponent(context.organizationId)}`;
  const organizationName =
    segments[1] === context.organizationId ? context.organizationName : "Organization";

  if (segments[1] === "new-organization") {
    return [
      { label: context.organizationName, href: organizationRoot },
      { label: "Request an organization" },
    ];
  }

  if (segments.length < 3) return [{ label: organizationName }];

  const organizationCrumb: DashboardBreadcrumbItem = {
    label: organizationName,
    href: organizationRoot,
  };
  const section = segments[2];
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
