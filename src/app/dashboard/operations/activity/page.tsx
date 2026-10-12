import { redirect } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { ActivityPagination } from "@/components/activity-pagination";
import { OperationsShell } from "@/components/operations-shell";
import { getCurrentSession, isAdministrator, listPlatformAudit } from "@/lib/auth/service";

function parseRequestedPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export default async function PlatformActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");

  const query = await searchParams;
  const activity = await listPlatformAudit(
    current.subject.subjectId,
    parseRequestedPage(query.page),
  );

  return (
    <OperationsShell
      breadcrumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Platform admin", href: "/dashboard/operations" },
        { label: "Activity history" },
      ]}
    >
      <ActivityFeed
        entries={activity.entries}
        emptyMessage="No platform activity has been recorded yet."
        showPlatformContext
        title="Activity history"
        description="Recent changes across Perminister, including older access records."
      />
      <ActivityPagination
        page={activity.page}
        totalPages={activity.totalPages}
        hrefBase="/dashboard/operations/activity"
      />
    </OperationsShell>
  );
}
