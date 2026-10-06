import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Perminister — shared identity and access",
  description:
    "A standalone identity and access service for consumer applications, including product-scoped permissions and API keys.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <meta name="referrer" content="no-referrer" />
      </head>
      <body>{children}</body>
    </html>
  );
}
