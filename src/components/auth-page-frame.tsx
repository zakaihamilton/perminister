import type { ReactNode } from "react";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export function AuthPageFrame({
  children,
  authenticated,
}: {
  children: ReactNode;
  authenticated?: boolean;
}) {
  return (
    <>
      <SiteHeader active="none" authenticated={authenticated} />
      <main className="page-shell auth-page-shell">
        <div className="container auth-page">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}

export function AuthReturnToSignIn() {
  return (
    <div className="auth-links">
      <Link href="/login">Return to sign in</Link>
    </div>
  );
}
