import type { Metadata } from "next";
import { InvitationView } from "@/components/invitation-view";
import { getCurrentSession } from "@/lib/auth/service";

export const metadata: Metadata = {
  title: "Accept your invitation",
  description: "Join your organization in Perminister.",
  robots: { index: false, follow: false },
};

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const [current, query] = await Promise.all([getCurrentSession(), searchParams]);
  const token = query.token ?? "";
  const hasToken = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i.test(token);
  return <InvitationView token={token} hasToken={hasToken} current={current} error={query.error} />;
}
