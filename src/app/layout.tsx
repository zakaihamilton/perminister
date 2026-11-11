import type { ReactNode } from "react";
import { Suspense } from "react";
import Script from "next/script";
import { ActionRefreshNotice } from "@/components/action-refresh-notice";
import { UrlNoticeCleanser } from "@/components/url-notice-cleanser";
import "./globals.css";
import publicPageStyles from "./styles/public-pages.module.css";
import dashboardGuideStyles from "./styles/dashboard-and-guide.module.css";
import organizationDashboardStyles from "./styles/organization-dashboard.module.css";
import visualSystemStyles from "./styles/visual-system.module.css";
import organizationOverviewStyles from "./styles/organization-overview.module.css";
import dashboardComponentStyles from "./styles/dashboard-components.module.css";

const appStyleScope = [
  publicPageStyles.appScope,
  dashboardGuideStyles.appScope,
  organizationDashboardStyles.appScope,
  visualSystemStyles.appScope,
  organizationOverviewStyles.appScope,
  dashboardComponentStyles.appScope,
].join(" ");

const themeBootstrap = `(() => {
  let choice = "system";
  try {
    const stored = localStorage.getItem("perminister-theme");
    if (stored === "light" || stored === "dark" || stored === "system") choice = stored;
  } catch {}
  const dark = choice === "dark" || (choice === "system" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();`;

export const metadata = {
  title: "Perminister — shared identity and access",
  description:
    "A standalone identity and access service for consumer applications, including product-scoped permissions and API keys.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <meta name="referrer" content="no-referrer" />
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
      </head>
      <body className={appStyleScope}>
        <Suspense fallback={null}>
          <ActionRefreshNotice />
          <UrlNoticeCleanser />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
