import type { ReactNode } from "react";
import { Suspense } from "react";
import Script from "next/script";
import { ActionRefreshNotice } from "@/components/action-refresh-notice";
import "./globals.css";

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
      <body>
        <Suspense fallback={null}>
          <ActionRefreshNotice />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
