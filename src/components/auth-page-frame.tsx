import type { ReactNode } from "react";
import Link from "next/link";
import { AuthShell } from "panel-frame-ui";
import { Brand } from "@/components/site-shell";
import { ThemeControl } from "@/components/theme-control";

export function AuthPageFrame({ children }: { children: ReactNode }) {
  return (
    <AuthShell
      brand={<Brand />}
      aside={
        <>
          <p className="eyebrow">Account access</p>
          <h1>Your organizations, products, and permissions in one place.</h1>
          <p>Use one secure account to manage your memberships, sessions, and API keys.</p>
        </>
      }
      utility={<ThemeControl />}
      footer={<Link href="/privacy">Privacy policy</Link>}
    >
      {children}
    </AuthShell>
  );
}

export function AuthReturnToSignIn() {
  return (
    <div className="auth-links">
      <Link href="/login">Return to sign in</Link>
    </div>
  );
}
