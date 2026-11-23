// biome-ignore-all assist/source/organizeImports: CSS module import order defines cascade
import Script from "next/script";
import { getThemeBootstrapScript, ThemeProvider } from "panel-frame-ui";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { ActionRefreshNotice } from "@/components/action-refresh-notice";
import { UrlNoticeCleanser } from "@/components/url-notice-cleanser";
import "./globals.css";
import tokensAndBaseStyles from "./styles/tokens-and-base.module.css";
import shellStyles from "./styles/shell.module.css";
import marketingWelcomeStyles from "./styles/marketing-welcome.module.css";
import authPagesStyles from "./styles/auth-pages.module.css";
import productPagesStyles from "./styles/product-pages.module.css";
import operationsStyles from "./styles/operations.module.css";
import developersStyles from "./styles/developers.module.css";

const appStyleScope = [
  tokensAndBaseStyles.appScope,
  shellStyles.appScope,
  marketingWelcomeStyles.appScope,
  authPagesStyles.appScope,
  productPagesStyles.appScope,
  operationsStyles.appScope,
  developersStyles.appScope,
].join(" ");

const themePersistence = { type: "localStorage" as const, key: "perminister-theme" };
const themeBootstrap = getThemeBootstrapScript(themePersistence, { systemMode: "resolved" });

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
        <ThemeProvider persistence={themePersistence} systemMode="resolved">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
