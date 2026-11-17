import { ActivityFeed } from "@/components/activity-feed";
import { ActivityPagination } from "@/components/activity-pagination";
import { OperationsShell } from "@/components/operations-shell";
import type { OperationsQuery } from "@/components/operations-types";
import { getOperationsPageContext } from "@/lib/auth/operations-page-context";
import { listPlatformAudit } from "@/lib/auth/service";
import { operationsBreadcrumbs, operationsHref } from "@/lib/operations-navigation";

function parseRequestedPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export default async function PlatformActivityPage({
  searchParams,
}: {
  searchParams: Promise<OperationsQuery>;
}) {
  const query = await searchParams;
  const context = await getOperationsPageContext(query.organizationId);
  const activity = context.organizationId
    ? await listPlatformAudit(
        context.current.subject.subjectId,
        parseRequestedPage(query.page),
        context.organizationId,
      )
    : await listPlatformAudit(context.current.subject.subjectId, parseRequestedPage(query.page));

  return (
    <OperationsShell
      context={context}
      breadcrumbs={operationsBreadcrumbs(context.organizationId, "Activity history")}
    >
      <ActivityFeed
        entries={activity.entries}
        emptyMessage={
          context.organizationId
            ? "No organization activity has been recorded yet."
            : "No platform activity has been recorded yet."
        }
        showPlatformContext
        title="Activity history"
        description={
          context.selectedOrganization
            ? `Recent changes to ${context.selectedOrganization.organization.name}.`
            : "Recent changes across Perminister, including platform-wide activity."
        }
      />
      <ActivityPagination
        page={activity.page}
        totalPages={activity.totalPages}
        hrefBase={operationsHref("/dashboard/operations/activity", context.organizationId)}
      />
    </OperationsShell>
  );
}
