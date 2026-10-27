import { SessionList } from "@/components/session-list";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { getCurrentSession, listSessionsForSubject } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [current, { organizationId }, query] = await Promise.all([
    getCurrentSession(),
    params,
    searchParams,
  ]);
  if (!current) redirect("/login");
  const sessions = await listSessionsForSubject(current.subject.subjectId);
  const returnTo = `/dashboard/${organizationId}/sessions`;
  return (
    <>
      <DashboardHeading description="Review devices signed in to your account. Sign out any device you no longer use." />
      {query.notice === "session-revoked" ? (
        <DashboardNotice message="Device signed out." kind="success" />
      ) : null}
      {query.notice === "session-revoke-failed" ? (
        <DashboardNotice message="Could not sign out that device." kind="error" />
      ) : null}
      <SessionList
        sessions={sessions}
        currentSessionId={current.session.sessionId}
        returnTo={returnTo}
      />
    </>
  );
}
