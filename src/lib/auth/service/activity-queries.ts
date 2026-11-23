import "server-only";

import { type AuthEvent, assertOpaqueId, type SubjectId, type SubjectRecord } from "../domain";
import { authMutationQueue } from "../mutation-queue";
import {
  type AuditEntry,
  activityBelongsToOrganization,
  auditEntriesForEvents,
  type OrganizationActivityEntry,
  type OrganizationActivityPageData,
  organizationActivityEntries,
  type PlatformAuditPage,
  platformActivityEntries,
} from "./activity-formatting";
import { requireProductRoleUnlocked } from "./core";
import { getOrganizationDashboardData } from "./organizations";
import {
  loadApprovedOrganizationUnlocked,
  organizationMembershipUnlocked,
  requireAdministrator,
  requireOrganizationRoleUnlocked,
  store,
} from "./persistence";
import { requireVerifiedActiveSubject } from "./validators";

const PLATFORM_AUDIT_PAGE_SIZE = 25;
const PLATFORM_AUDIT_MAX_EVENTS = 100;

export async function listOrganizationAudit(
  subjectId: SubjectId,
  organizationId: string,
  limit = 100,
): Promise<OrganizationActivityEntry[]> {
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(subjectId, organizationId, ["owner", "admin"]);
    const cappedLimit = Math.min(100, Math.max(0, Math.floor(limit)));
    const events = await store().listOrganizationEvents(organizationId, undefined, cappedLimit);
    return organizationActivityEntries(
      events
        .filter((event) => activityBelongsToOrganization(event, organizationId))
        .slice(0, cappedLimit),
    );
  });
}

export async function getOrganizationActivityPageData(
  actor: SubjectRecord,
  organizationId: string,
): Promise<OrganizationActivityPageData> {
  return authMutationQueue.read(async () => {
    assertOpaqueId(organizationId);
    const subjectId = actor.subjectId;
    const [organization, membership] = await Promise.all([
      loadApprovedOrganizationUnlocked(organizationId),
      organizationMembershipUnlocked(organizationId, subjectId),
    ]);
    requireVerifiedActiveSubject(actor);
    if (!organization) throw new Error("Organization not found.");

    const productMembership = membership
      ? null
      : (await store().listMembershipsForSubject(subjectId)).find(
          (item) =>
            item.organizationId === organizationId && !!item.productId && item.status === "active",
        );
    const role = membership?.role ?? (productMembership ? "member" : null);
    if (!role) throw new Error("Organization not found.");
    if (role === "member") return { role, entries: [] };

    const [dashboardData, events] = await Promise.all([
      getOrganizationDashboardData(subjectId, organizationId),
      store()
        .listOrganizationEvents(organizationId, undefined, 100)
        .then((records) =>
          records
            .filter((event) => activityBelongsToOrganization(event, organizationId))
            .slice(0, 100),
        ),
    ]);

    const productNames = new Map(
      dashboardData.products.map((product) => [product.productId, product.name]),
    );
    const entries = await organizationActivityEntries(events, false, productNames, [actor]);
    return { role, entries };
  });
}

export async function listProductAudit(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<OrganizationActivityEntry[]> {
  return authMutationQueue.read(async () => {
    await requireProductRoleUnlocked(subjectId, organizationId, productId, [
      "owner",
      "admin",
      "member",
    ]);
    return organizationActivityEntries(
      (await store().listOrganizationEvents(organizationId, productId, 100)).slice(0, 100),
    );
  });
}

export async function listPlatformAudit(
  actorId: SubjectId,
  requestedPage = 1,
  organizationId?: string,
): Promise<PlatformAuditPage> {
  return authMutationQueue.read(async () => {
    await requireAdministrator(actorId);
    const activityStore = store();
    let events: AuthEvent[];
    if (organizationId !== undefined) {
      assertOpaqueId(organizationId);
      const organization = await loadApprovedOrganizationUnlocked(organizationId);
      if (!organization) throw new Error("Organization not found.");
      events = (await activityStore.listOrganizationEvents(
        organizationId,
        undefined,
        PLATFORM_AUDIT_MAX_EVENTS,
      ))
        .filter((event) => activityBelongsToOrganization(event, organizationId))
        .slice(0, PLATFORM_AUDIT_MAX_EVENTS);
    } else {
      events = (
        typeof activityStore.listRecentEvents === "function"
          ? await activityStore.listRecentEvents(PLATFORM_AUDIT_MAX_EVENTS)
          : await activityStore.listAllEvents()
      ).slice(0, PLATFORM_AUDIT_MAX_EVENTS);
    }
    const totalItems = events.length;
    const totalPages = Math.ceil(totalItems / PLATFORM_AUDIT_PAGE_SIZE);
    const validPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const page = totalPages > 0 ? Math.min(validPage, totalPages) : 1;
    const offset = (page - 1) * PLATFORM_AUDIT_PAGE_SIZE;

    return {
      entries: await platformActivityEntries(
        events.slice(offset, offset + PLATFORM_AUDIT_PAGE_SIZE),
      ),
      page,
      pageSize: PLATFORM_AUDIT_PAGE_SIZE,
      totalItems,
      totalPages,
    };
  });
}

export async function listAuditForSubject(subject: SubjectRecord): Promise<AuditEntry[]> {
  return auditEntriesForEvents(await store().listAllEvents(), subject);
}
