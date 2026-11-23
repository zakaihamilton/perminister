import "server-only";

import { mapWithConcurrency } from "../concurrency";
import type {
  AuthEvent,
  AuthRecord,
  AuthRecordKind,
  EventId,
  OrganizationRole,
  SubjectId,
  SubjectRecord,
} from "../domain";
import { loadRecord, store } from "./persistence";
import { eventPayloadId, isAdministrator } from "./validators";

export interface ActivityDetail {
  label: string;
  value?: string;
  before?: string;
  after?: string;
}

export interface OrganizationActivityEntry {
  eventId: EventId;
  type: string;
  summary: string;
  occurredAt: string;
  actor: string;
  target: string;
  affectedUser: string | null;
  aggregateKind: string;
  details: ActivityDetail[];
}

export interface OrganizationActivityPageData {
  role: OrganizationRole;
  entries: OrganizationActivityEntry[];
}

export interface PlatformActivityEntry extends OrganizationActivityEntry {
  organization: string;
  user: string | null;
  actorIsUser: boolean;
}

export interface PlatformAuditPage {
  entries: PlatformActivityEntry[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface AuditEntry {
  eventId: EventId;
  type: string;
  occurredAt: string;
  actor: string;
  aggregateKind: string;
}

const ACTIVITY_READ_CONCURRENCY = 40;

const ACTIVITY_SUMMARIES: Readonly<Record<string, string>> = {
  "api-key.created": "Created an API key",
  "api-key.revoked": "Revoked an API key",
  "api-key.rotated.created": "Created a replacement API key",
  "api-key.rotated.revoked-previous": "Revoked the previous API key",
  "api-key.service-created": "Created an integration API key",
  "api-key.service-revoked": "Revoked an integration API key",
  "api-key.service-rotated.created": "Created a replacement integration API key",
  "api-key.service-rotated.revoked-previous": "Revoked the previous integration API key",
  "consumer-client.created": "Created an application client",
  "consumer-client.updated": "Updated application client settings",
  "consumer-client.secret-rotated": "Rotated an application client secret",
  "consumer-client.revoked": "Revoked an application client",
  "consumer-client.publisher-transferred": "Transferred an application client to a new publisher",
  "consumer.member-role-updated": "Changed a member's application role",
  "credential.admin-reset": "Reset an account password",
  "credential.password-changed": "Changed an account password",
  "credential.password-reset": "Reset an account password",
  "identity.admin-provisioned": "Provisioned an account",
  "identity.disabled": "Disabled an account",
  "identity.enabled": "Enabled an account",
  "identity.profile-updated": "Updated an account profile",
  "identity.registered": "Created an account",
  "organization.approved": "Approved an organization",
  "organization.member-added": "Added an organization member",
  "organization.member-removed": "Removed an organization member",
  "organization.member-role-updated": "Changed an organization member role",
  "organization.rejected": "Rejected an organization",
  "organization.requested": "Requested an organization",
  "organization.updated": "Updated an organization",
  "organization.invitation-created": "Invited an organization administrator",
  "organization.invitation-replaced": "Replaced an organization invitation",
  "organization.invitation-revoked": "Revoked an organization invitation",
  "organization.invitation-consumed": "Accepted an organization invitation",
  "organization.catalog-manager-invitation-accepted": "Accepted an organization invitation",
  "permission.granted": "Granted permissions",
  "permission.revoked": "Revoked permissions",
  "permission.restored": "Restored permissions",
  "permission.deleted": "Deleted a disabled permission",
  "product.access-role-created": "Created a product access role",
  "product.access-role-removed": "Removed a product access role",
  "product.access-role-updated": "Updated a product access role",
  "product.archived": "Archived a product",
  "product.created": "Created a product",
  "product.deleted": "Deleted a product",
  "product.deletion-started": "Started deleting a product",
  "product.member-added": "Added a product member",
  "product.member-keys-revoked": "Revoked a removed member's API keys",
  "product.member-removed": "Removed a product member",
  "product.member-reactivated": "Reactivated a product member",
  "product.member-role-updated": "Changed a product member role",
  "product.moved": "Moved a product into this organization",
  "product.moved-from": "Moved a product out of this organization",
  "product.owner-assigned": "Assigned a product owner",
  "product.published": "Published a product",
  "product.restored": "Restored a product",
  "product.shared-installed": "Installed a shared product",
  "product.shared-installation-reactivated": "Reactivated a shared product installation",
  "product.shared-installation-removed": "Removed a shared product installation",
  "product.shared-installation-repointed": "Moved a shared product installation",
  "product.transferred": "Transferred a product",
  "product.transferred-from": "Transferred a product",
  "product.unpublished": "Unpublished a product",
  "product.updated": "Updated a product",
  "product.invitation-created": "Invited a product member",
  "product.invitation-replaced": "Replaced a product invitation",
  "product.invitation-revoked": "Revoked a product invitation",
  "product.invitation-accepted": "Accepted a product invitation",
  "product.shared-invitation-revoked": "Revoked a shared product invitation",
  "service-principal.created": "Created an integration",
  "service-principal.disabled": "Disabled an integration",
  "service-principal.enabled": "Enabled an integration",
  "session.created": "Signed in",
  "session.consumer-created": "Signed in to a product",
  "session.revoked": "Signed out",
};

const ACTIVITY_CHANGE_LABELS: Readonly<Record<string, string>> = {
  actions: "Allowed actions",
  role: "Role",
  status: "Status",
};

function humanizeActivityType(type: string): string {
  return type
    .split(".")
    .map((part) => part.replaceAll("-", " "))
    .join(" · ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function activitySummary(type: string): string {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_SUMMARIES, type)
    ? ACTIVITY_SUMMARIES[type]
    : humanizeActivityType(type);
}

function platformEventOrganizationId(event: AuthEvent): string | null {
  return (
    eventPayloadId(event, "organizationId") ??
    (event.aggregate.kind === "organization" ? event.aggregate.id : null)
  );
}

function platformEventUserId(event: AuthEvent): string | null {
  if (event.aggregate.kind === "organization-invitation") {
    // Older invitation payloads used subjectId for the creator. On acceptance, the actor is
    // the invited account; create and revoke events do not have an associated account yet.
    return event.type === "organization.invitation-consumed" && event.actor.kind === "subject"
      ? event.actor.subjectId
      : null;
  }
  return eventPayloadId(event, "subjectId");
}

function activitySubjectId(event: AuthEvent): string | null {
  return platformEventUserId(event);
}

function activitySubjectLabel(
  subjectId: string,
  subjects: ReadonlyMap<string, SubjectRecord>,
  includeEmail = false,
): string {
  const subject = subjects.get(subjectId);
  if (!subject) return `Account ${subjectId}`;
  const name = [subject.firstName, subject.lastName].filter(Boolean).join(" ");
  if (includeEmail && name && subject.primaryEmail) return `${name} (${subject.primaryEmail})`;
  return name || (includeEmail ? subject.primaryEmail : null) || `Account ${subjectId}`;
}

function eventAggregateRecordKind(event: AuthEvent): AuthRecordKind | null {
  return event.aggregate.kind === "directory" ? null : event.aggregate.kind;
}

async function activityAggregateRecord(
  event: AuthEvent,
  productNames: ReadonlyMap<string, string>,
): Promise<AuthRecord | null> {
  const kind = eventAggregateRecordKind(event);
  if (!kind) return null;
  try {
    const organizationId = eventPayloadId(event, "organizationId");
    const subjectId = eventPayloadId(event, "subjectId");
    switch (event.aggregate.kind) {
      case "product": {
        const productId = event.payload.productId;
        if (organizationId && typeof productId === "string") {
          if (
            event.type === "product.deleted" ||
            event.type === "product.deletion-started"
          ) {
            return (await loadRecord("product", event.aggregate.id))?.record ?? null;
          }
          if (productNames.has(productId)) return null;
          return await store().readProduct(organizationId, productId);
        }
        break;
      }
      case "organization-membership":
        // The subject is already loaded for the activity row, so the membership record
        // cannot change its target label when its stable IDs are present in the payload.
        if (organizationId && subjectId) return null;
        break;
      case "membership": {
        if (typeof event.payload.accessRoleName === "string") return null;
        const productId = event.payload.productId;
        if (organizationId && subjectId && typeof productId === "string") {
          const membership = await store().readOrganizationMembership(
            organizationId,
            subjectId as SubjectId,
            productId,
          );
          return (
            membership?.permissionGrants?.find(
              (grant) => grant.membershipId === event.aggregate.id,
            ) ?? null
          );
        }
        break;
      }
      case "organization-invitation":
        if (organizationId) return null;
        break;
      case "subject":
        if (subjectId) return null;
        break;
      case "service-principal":
        return null;
      case "consumer-authorization-code":
      case "session":
      case "email-action":
        return null;
      default:
        break;
    }
    return (await loadRecord(kind, event.aggregate.id))?.record ?? null;
  } catch {
    return null;
  }
}

function activityTargetLabel(
  event: AuthEvent,
  record: AuthRecord | null,
  subjects: ReadonlyMap<string, SubjectRecord>,
  includeSubjectEmails: boolean,
  servicePrincipalNames: ReadonlyMap<string, string>,
  productNames: ReadonlyMap<string, string>,
): string {
  if (
    (event.type === "product.transferred" ||
      event.type === "product.moved" ||
      event.type === "product.moved-from" ||
      event.type === "product.deleted" ||
      event.type === "product.deletion-started") &&
    typeof event.payload.productName === "string"
  ) {
    return event.payload.productName;
  }
  if (event.aggregate.kind === "organization-invitation" && event.type.startsWith("product.")) {
    return "Product invitation";
  }
  if (
    event.aggregate.kind === "organization-invitation" &&
    eventPayloadId(event, "organizationId")
  ) {
    return typeof event.payload.productId === "string"
      ? "Product invitation"
      : "Organization invitation";
  }
  if (event.aggregate.kind === "organization-membership") {
    const subjectId = eventPayloadId(event, "subjectId");
    if (subjectId) return activitySubjectLabel(subjectId, subjects, includeSubjectEmails);
  }
  if (event.aggregate.kind === "membership" && typeof event.payload.accessRoleName === "string") {
    return `${event.payload.accessRoleName} permission grant`;
  }
  if (event.aggregate.kind === "subject") {
    const subjectId = eventPayloadId(event, "subjectId");
    if (subjectId) return activitySubjectLabel(subjectId, subjects, includeSubjectEmails);
  }
  if (event.aggregate.kind === "service-principal") {
    return servicePrincipalNames.get(event.aggregate.id) ?? "Service Principal";
  }
  if (event.aggregate.kind === "consumer-authorization-code") return "Authorization code";
  if (event.aggregate.kind === "session") return "Session";
  if (event.aggregate.kind === "email-action") return "Email action";
  if (event.aggregate.kind === "product" && typeof event.payload.productId === "string") {
    const productName = productNames.get(event.payload.productId);
    if (productName) return productName;
  }
  if (record) {
    switch (record.kind) {
      case "organization":
        return record.name;
      case "organization-membership":
        return activitySubjectLabel(record.subjectId, subjects, includeSubjectEmails);
      case "product":
        return record.name;
      case "organization-invitation":
        return record.productId ? "Product invitation" : "Organization invitation";
      case "subject":
        return activitySubjectLabel(record.subjectId, subjects, includeSubjectEmails);
      case "membership":
        return record.accessRole?.name
          ? `${record.accessRole.name} permission grant`
          : "Permission grant";
      case "service-principal":
        return record.name;
      case "api-key":
        return `${record.keyClass.replaceAll("-", " ")} API key`;
      case "consumer-client":
        return record.appName;
      case "oauth-client-registration":
        return record.clientName;
      case "consumer-authorization-code":
        return "Authorization code";
      case "session":
        return "Session";
      case "email-action":
        return "Email action";
    }
  }
  if (event.aggregate.kind === "directory") return "Directory";
  return humanizeActivityType(event.aggregate.kind);
}

function activityDetailValue(value: unknown): string | null {
  if (value === null) return "None";
  if (typeof value === "string") return value.slice(0, 300);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join(", ").slice(0, 300) || "None";
  }
  return null;
}

function activityDetails(event: AuthEvent): ActivityDetail[] {
  const details: ActivityDetail[] = [{ label: "Event type", value: event.type }];
  const payloadDetailLabels: Readonly<Record<string, string>> = {
    accessRoleName: "Access role",
    expiresAt: "Expires",
    invitationExpiresAt: "Invitation expires",
    invitationRole: "Invitation role",
    keyClass: "Key type",
    productName: "Product",
  };
  for (const [key, label] of Object.entries(payloadDetailLabels)) {
    const value = activityDetailValue(event.payload[key]);
    if (value && value !== "None") details.push({ label, value });
  }

  const rawChanges = event.payload.changes;
  if (!Array.isArray(rawChanges)) return details;
  for (const change of rawChanges) {
    if (typeof change !== "object" || change === null || Array.isArray(change)) continue;
    const field = change.field;
    if (
      typeof field !== "string" ||
      !Object.prototype.hasOwnProperty.call(ACTIVITY_CHANGE_LABELS, field)
    ) {
      continue;
    }
    const before = activityDetailValue(change.before);
    const after = activityDetailValue(change.after);
    if (before === null || after === null) continue;
    details.push({ label: ACTIVITY_CHANGE_LABELS[field], before, after });
  }
  return details;
}

export function activityBelongsToOrganization(event: AuthEvent, organizationId: string): boolean {
  const eventOrganizationId =
    typeof event.payload.organizationId === "string"
      ? event.payload.organizationId
      : event.aggregate.kind === "organization"
        ? event.aggregate.id
        : null;
  return eventOrganizationId === organizationId;
}

export async function organizationActivityEntries(
  events: readonly AuthEvent[],
  includeSubjectEmails = false,
  productNames: ReadonlyMap<string, string> = new Map(),
  knownSubjects: readonly SubjectRecord[] = [],
): Promise<OrganizationActivityEntry[]> {
  const aggregateReferences = new Map<string, AuthEvent>();
  for (const event of events) {
    const kind = eventAggregateRecordKind(event);
    if (!kind) continue;
    const key = JSON.stringify([kind, event.aggregate.id]);
    if (!aggregateReferences.has(key)) aggregateReferences.set(key, event);
  }
  const aggregateReferenceEntries = [...aggregateReferences.entries()];
  const subjectIds = new Set<string>();
  const servicePrincipalIds = new Set<string>();
  for (const event of events) {
    const subjectId = activitySubjectId(event);
    if (subjectId) subjectIds.add(subjectId);
    if (event.actor.kind === "subject") subjectIds.add(event.actor.subjectId);
    if (event.actor.kind === "service") servicePrincipalIds.add(event.actor.servicePrincipalId);
    if (event.aggregate.kind === "service-principal") {
      servicePrincipalIds.add(event.aggregate.id);
    }
  }

  const subjectRecords = new Map<string, SubjectRecord>();
  for (const subject of knownSubjects) subjectRecords.set(subject.subjectId, subject);
  const servicePrincipalNames = new Map<string, string>();
  const aggregateRecordsPromise = mapWithConcurrency(
    aggregateReferenceEntries.map(([, event]) => event),
    (event) => activityAggregateRecord(event, productNames),
    ACTIVITY_READ_CONCURRENCY,
  );
  const loadSubjects = (ids: Iterable<string>) =>
    mapWithConcurrency(
      [...ids],
      async (subjectId) => {
        try {
          const subject = await loadRecord("subject", subjectId);
          return { id: subjectId, record: subject?.record ?? null };
        } catch {
          return { id: subjectId, record: null };
        }
      },
      ACTIVITY_READ_CONCURRENCY,
    );
  const [aggregateRecords, subjects, servicePrincipals] = await Promise.all([
    aggregateRecordsPromise,
    loadSubjects([...subjectIds].filter((subjectId) => !subjectRecords.has(subjectId))),
    mapWithConcurrency(
      [...servicePrincipalIds],
      async (servicePrincipalId) => {
        try {
          const principal = await loadRecord("service-principal", servicePrincipalId);
          return { id: servicePrincipalId, name: principal?.record.name ?? null };
        } catch {
          return { id: servicePrincipalId, name: null };
        }
      },
      ACTIVITY_READ_CONCURRENCY,
    ),
  ]);
  const aggregateRecordByKey = new Map(
    aggregateReferenceEntries.map(([key], index) => [key, aggregateRecords[index]]),
  );
  const aggregateRecordForEvent = (event: AuthEvent): AuthRecord | null => {
    const kind = eventAggregateRecordKind(event);
    if (!kind) return null;
    return aggregateRecordByKey.get(JSON.stringify([kind, event.aggregate.id])) ?? null;
  };
  for (const subject of subjects) {
    if (subject.record) subjectRecords.set(subject.id, subject.record);
  }
  for (const principal of servicePrincipals) {
    if (principal.name) servicePrincipalNames.set(principal.id, principal.name);
  }
  for (const record of aggregateRecords) {
    if (record?.kind === "organization-membership" || record?.kind === "membership") {
      subjectIds.add(record.subjectId);
    } else if (record?.kind === "subject") {
      subjectRecords.set(record.subjectId, record);
    } else if (record?.kind === "service-principal") {
      servicePrincipalNames.set(record.servicePrincipalId, record.name);
    }
  }
  const additionalSubjectIds = [...subjectIds].filter(
    (subjectId) => !subjectRecords.has(subjectId),
  );
  if (additionalSubjectIds.length > 0) {
    const additionalSubjects = await loadSubjects(additionalSubjectIds);
    for (const subject of additionalSubjects) {
      if (subject.record) subjectRecords.set(subject.id, subject.record);
    }
  }
  return events.map((event) => {
    const actor =
      event.actor.kind === "subject"
        ? activitySubjectLabel(event.actor.subjectId, subjectRecords, includeSubjectEmails)
        : event.actor.kind === "service"
          ? (servicePrincipalNames.get(event.actor.servicePrincipalId) ?? "Service integration")
          : "System";
    const subjectId = activitySubjectId(event);
    const record = aggregateRecordForEvent(event);
    return {
      eventId: event.eventId,
      type: event.type,
      summary: activitySummary(event.type),
      occurredAt: event.occurredAt,
      actor,
      target: activityTargetLabel(
        event,
        record,
        subjectRecords,
        includeSubjectEmails,
        servicePrincipalNames,
        productNames,
      ),
      affectedUser: subjectId
        ? activitySubjectLabel(subjectId, subjectRecords, includeSubjectEmails)
        : null,
      aggregateKind: event.aggregate.kind,
      details: activityDetails(event),
    };
  });
}

export async function platformActivityEntries(
  events: readonly AuthEvent[],
): Promise<PlatformActivityEntry[]> {
  const organizationIds = new Set<string>();
  for (const event of events) {
    const organizationId = platformEventOrganizationId(event);
    const sourceOrganizationId = eventPayloadId(event, "sourceOrganizationId");
    if (organizationId) organizationIds.add(organizationId);
    if (sourceOrganizationId) organizationIds.add(sourceOrganizationId);
  }

  const [organizations, entries] = await Promise.all([
    mapWithConcurrency(
      [...organizationIds],
      async (organizationId) => {
        try {
          const organization = await loadRecord("organization", organizationId);
          return { id: organizationId, name: organization?.record.name ?? null };
        } catch {
          return { id: organizationId, name: null };
        }
      },
      ACTIVITY_READ_CONCURRENCY,
    ),
    organizationActivityEntries(events, true),
  ]);
  const organizationNames = new Map<string, string>();
  for (const organization of organizations) {
    if (organization.name) organizationNames.set(organization.id, organization.name);
  }
  return events.map((event, index) => {
    const organizationId = platformEventOrganizationId(event);
    const userId = platformEventUserId(event);
    const entry = entries[index];
    return {
      ...entry,
      organization: organizationId
        ? (organizationNames.get(organizationId) ?? `Organization ${organizationId}`)
        : "Platform-wide",
      user: entry.affectedUser,
      actorIsUser: event.actor.kind === "subject" && event.actor.subjectId === userId,
      details: [
        ...entry.details,
        ...(event.type === "product.transferred" ||
        event.type === "product.moved" ||
        event.type === "product.moved-from"
          ? [
              {
                label: event.type.startsWith("product.moved") ? "Move" : "Transfer",
                value: `${event.payload.productName ?? entry.target} ${
                  event.type === "product.moved-from" ? "moved from" : "transferred from"
                } ${
                  organizationNames.get(eventPayloadId(event, "sourceOrganizationId") ?? "") ??
                  "the source organization"
                } to ${
                  organizationNames.get(eventPayloadId(event, "destinationOrganizationId") ?? "") ??
                  "the destination organization"
                }`,
              },
            ]
          : []),
      ],
    };
  });
}

export function auditEntriesForEvents(
  events: readonly AuthEvent[],
  subject: SubjectRecord,
): AuditEntry[] {
  const administrator = isAdministrator(subject);
  return events
    .filter((event) => {
      if (administrator) return true;
      if (event.actor.kind === "subject" && event.actor.subjectId === subject.subjectId)
        return true;
      return event.payload.subjectId === subject.subjectId;
    })
    .slice(0, 100)
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      occurredAt: event.occurredAt,
      actor: event.actor.kind === "subject" ? "account" : event.actor.kind,
      aggregateKind: event.aggregate.kind,
    }));
}
