import { notFound } from "next/navigation";
import { PreviewDropdown, PreviewToolbar } from "ui-preview-kit";
import { AuthLinkContent } from "@/components/auth-link-pages";
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs";
import { DashboardNotice, DashboardShell } from "@/components/dashboard-shell";
import { isUiPreviewAllowed } from "@/lib/ui-preview-access";
import {
  createPreviewContext,
  organizationId,
  previewScreens,
  scenarioOptions,
  scenarioScreen,
} from "./fixtures";
import { OperationsPreviewScreens } from "./operations-screens";
import { OrganizationPreviewScreens } from "./organization-screens";
import { PreviewGuard } from "./preview-guard";
import { PreviewOrganizationSwitcher } from "./preview-organization-switcher";
import { ProductPreviewScreens } from "./product-screens";

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; screen?: string }>;
}) {
  if (!isUiPreviewAllowed()) notFound();
  const context = createPreviewContext(await searchParams);
  const {
    screen,
    scenario,
    previewRole,
    isPlatformAdministrator,
    previewPathname,
    organizationName,
    previewProducts,
    previewOrganizations,
  } = context;

  return (
    <PreviewGuard>
      <DashboardShell
        organizationId={organizationId}
        organizationName={organizationName}
        organizations={previewOrganizations}
        sidebarOrganizationSwitcher={
          <PreviewOrganizationSwitcher
            organizations={previewOrganizations}
            organizationId={organizationId}
          />
        }
        role={previewRole}
        isPlatformAdministrator={isPlatformAdministrator}
        navigationPathname={previewPathname}
        pendingOrganizationRequestCount={null}
        email="alex@example.test"
        firstName="Alex"
        lastName="Example"
        breadcrumbs={
          <DashboardBreadcrumbs
            organizationId={organizationId}
            organizationName={organizationName}
            products={previewProducts.map(({ productId, name }) => ({ productId, name }))}
            pathnameOverride={previewPathname}
          />
        }
      >
        <PreviewToolbar
          variant="card"
          subtitle="Synthetic data · changes are not saved"
          note="Dashboard links and submissions are disabled; filtering and display controls remain interactive."
          utilitiesLabel="Additional preview screens"
          utilities={
            <>
              <a href="/ui-preview/request">Request shell</a>
              <a href="/ui-preview/auth">Authorization and invitation</a>
            </>
          }
        >
          <PreviewDropdown
            label="Screen"
            value={screen}
            options={previewScreens.map((item) => ({
              value: item,
              label: item.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
              href: "/ui-preview?screen=" + encodeURIComponent(item) + "&scenario=" + scenario,
            }))}
          />
          <PreviewDropdown
            label="Scenario"
            value={scenario}
            options={scenarioOptions.map((option) => ({
              value: option.value,
              label: option.label,
              href:
                option.value === "no-organizations"
                  ? "/ui-preview/request?scenario=empty"
                  : "/ui-preview?screen=" +
                    encodeURIComponent(scenarioScreen[option.value] ?? screen) +
                    "&scenario=" +
                    option.value,
            }))}
          />
        </PreviewToolbar>
        {scenario === "access-denied" ? (
          <DashboardNotice
            kind="error"
            message="Perminister denied access to these product permissions. Ask an organization admin to review your role."
          />
        ) : null}
        {scenario === "validation-errors" ? (
          <DashboardNotice
            kind="info"
            message="Validation preview: try submitting this form with the required fields empty or malformed."
          />
        ) : null}
        {scenario === "no-organizations" ? (
          <DashboardNotice
            kind="info"
            message="This account has no organizations yet. Use the request shell to inspect the organization request flow."
          />
        ) : null}
        <ProductPreviewScreens context={context} />
        <OrganizationPreviewScreens context={context} />
        <OperationsPreviewScreens context={context} />
        {screen === "auth-verify" && (
          <AuthLinkContent kind="verify-email" params={{}} token="synthetic-preview-token" />
        )}
        {screen === "auth-reset" && (
          <AuthLinkContent kind="reset-password" params={{}} token="synthetic-preview-token" />
        )}
      </DashboardShell>
    </PreviewGuard>
  );
}
