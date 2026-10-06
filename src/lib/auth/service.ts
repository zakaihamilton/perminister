import "server-only";

import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { cookies } from "next/headers";
import { authMutationQueue } from "./mutation-queue";
import { withOrganizationMutationLock } from "./coordination";
import { processLocalLoginThrottle } from "./login-throttle";
import {
  appendDirectoryRegistrationAndCheckIntegrity,
  appendEventAndCheckIntegrity,
  assertNoConflictingAggregateRevisions,
  assertUniqueDirectoryRegistrations,
} from "./integrity";
import {
  assertOpaqueId,
  newApiKeyId,
  newEmailActionId,
  newEventId,
  newInvitationId,
  newMembershipId,
  newOrganizationId,
  newOrganizationMembershipId,
  newProductRecordId,
  newSessionId,
  newSubjectId,
  type ApiKeyId,
  type ApiKeyRecord,
  type AuthActor,
  type AuthAggregate,
  type AuthEvent,
  type AuthRecord,
  type AuthRecordFor,
  type AuthRecordKind,
  type DirectoryId,
  type EmailActionId,
  type EmailActionRecord,
  type EventId,
  type InvitationId,
  type MembershipId,
  type MembershipRecord,
  type OrganizationId,
  type OrganizationInvitationRecord,
  type OrganizationMembershipId,
  type OrganizationMembershipRecord,
  type OrganizationRecord,
  type OrganizationRole,
  type PermissionGrant,
  type PasswordCredential,
  type ProductRecord,
  type ProductRecordId,
  type ResourceScope,
  type SessionId,
  type SessionRecord,
  type SubjectId,
  type SubjectRecord,
  type JsonValue,
} from "./domain";
import { createSpacesAuthStoreFromEnv, type VersionedRecord } from "./storage/spaces";

const SESSION_COOKIE = "perminister_session";
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const EMAIL_ACTION_LIFETIME_MS = 30 * 60 * 1000;
const DIRECTORY_ID = "00000000-0000-4000-8000-000000000001" as DirectoryId;
const DIRECTORY_AGGREGATE: AuthAggregate = { kind: "directory", id: DIRECTORY_ID };
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

let storeSingleton: ReturnType<typeof createSpacesAuthStoreFromEnv> | undefined;

function store() {
  storeSingleton ??= createSpacesAuthStoreFromEnv();
  return storeSingleton;
}

export async function checkAuthStorageReadiness(): Promise<void> {
  await store().checkReadiness();
}

export class InvalidAuthActionError extends Error {
  constructor(message = "This link is invalid or expired.") {
    super(message);
    this.name = "InvalidAuthActionError";
  }
}

export class MailDeliveryUnavailableError extends Error {
  constructor() {
    super("Email delivery is not configured. No email was sent.");
    this.name = "MailDeliveryUnavailableError";
  }
}

function canonicalEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.includes("..")) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

function validatePassword(password: string): void {
  if (password.length < 15) {
    throw new Error("Use a password with at least 15 characters.");
  }
  if (password.length > 256) {
    throw new Error("Password must be 256 characters or fewer.");
  }
}

function hashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalHex(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(actual)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

async function createPasswordCredential(password: string): Promise<PasswordCredential> {
  validatePassword(password);
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt);
  return {
    algorithm: "scrypt",
    encodedVerifier: `scrypt$v=1$N=32768$r=8$p=1$${salt.toString("base64url")}$${digest.toString("base64url")}`,
    updatedAt: new Date().toISOString(),
  };
}

async function verifyPassword(
  password: string,
  credential: PasswordCredential | null,
): Promise<boolean> {
  if (!credential || credential.algorithm !== "scrypt") {
    await scrypt(password, Buffer.alloc(16, 4));
    return false;
  }
  const parts = credential.encodedVerifier.split("$");
  if (
    parts.length !== 7 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "v=1" ||
    parts[2] !== "N=32768" ||
    parts[3] !== "r=8" ||
    parts[4] !== "p=1"
  ) {
    await scrypt(password, Buffer.alloc(16, 4));
    return false;
  }
  try {
    const salt = Buffer.from(parts[5], "base64url");
    const expected = Buffer.from(parts[6], "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scrypt(password, salt);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function recordId(record: AuthRecord): string {
  switch (record.kind) {
    case "organization":
      return record.organizationId;
    case "organization-membership":
      return record.organizationMembershipId;
    case "product":
      return record.productRecordId;
    case "organization-invitation":
      return record.invitationId;
    case "subject":
      return record.subjectId;
    case "membership":
      return record.membershipId;
    case "api-key":
      return record.apiKeyId;
    case "session":
      return record.sessionId;
    case "email-action":
      return record.actionId;
  }
}

function aggregateFor(kind: AuthRecordKind, id: string): AuthAggregate {
  assertOpaqueId(id);
  switch (kind) {
    case "organization":
      return { kind, id: id as OrganizationId };
    case "organization-membership":
      return { kind, id: id as OrganizationMembershipId };
    case "product":
      return { kind, id: id as ProductRecordId };
    case "organization-invitation":
      return { kind, id: id as InvitationId };
    case "subject":
      return { kind, id: id as SubjectId };
    case "membership":
      return { kind, id: id as MembershipId };
    case "api-key":
      return { kind, id: id as ApiKeyId };
    case "session":
      return { kind, id: id as SessionId };
    case "email-action":
      return { kind, id: id as EmailActionId };
  }
}

function recordFromEvent<Kind extends AuthRecordKind>(
  value: unknown,
  kind: Kind,
  id: string,
): value is AuthRecordFor<Kind> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<AuthRecord>;
  if (record.kind !== kind || record.schemaVersion !== 1) return false;
  try {
    return recordId(record as AuthRecord) === id;
  } catch {
    return false;
  }
}

async function loadRecord<Kind extends AuthRecordKind>(
  kind: Kind,
  id: string,
): Promise<VersionedRecord<AuthRecordFor<Kind>> | null> {
  const objectStore = store();
  const aggregate = aggregateFor(kind, id);
  const [snapshot, events] = await Promise.all([
    objectStore.readRecord(kind, id),
    objectStore.listEvents(aggregate),
  ]);
  assertNoConflictingAggregateRevisions(events);
  let latest: { revision: number; record: AuthRecordFor<Kind> } | null = null;
  for (const event of events) {
    const value = event.payload.record;
    if (!recordFromEvent(value, kind, id)) {
      throw new Error(`Malformed ${kind} event for ${id} at revision ${event.aggregateVersion}`);
    }
    latest = { revision: event.aggregateVersion, record: value };
  }

  if (latest && (!snapshot || latest.revision > snapshot.revision)) {
    await objectStore.writeRecord(latest.record, latest.revision);
    return {
      formatVersion: 1,
      revision: latest.revision,
      writtenAt: new Date().toISOString(),
      record: latest.record,
    };
  }
  return snapshot;
}

async function persistRecord(record: AuthRecord, type: string, actor: AuthActor): Promise<void> {
  const objectStore = store();
  const id = recordId(record);
  const aggregate = aggregateFor(record.kind, id);
  const [snapshot, events] = await Promise.all([
    objectStore.readRecord(record.kind, id),
    objectStore.listEvents(aggregate),
  ]);
  assertNoConflictingAggregateRevisions(events);
  const revision =
    Math.max(snapshot?.revision ?? 0, ...events.map((event) => event.aggregateVersion)) + 1;
  const event: AuthEvent = {
    schemaVersion: 1,
    eventId: newEventId(),
    aggregate,
    aggregateVersion: revision,
    occurredAt: new Date().toISOString(),
    actor,
    type,
    payload: { record: record as unknown as JsonValue },
  };
  await appendEventAndCheckIntegrity(objectStore, event);
  await objectStore.writeRecord(record, revision);
}

function systemActor(): AuthActor {
  return { kind: "system" };
}

interface DirectoryEntry {
  email: string;
  subjectId: SubjectId;
  record: SubjectRecord;
}

function directoryEntry(event: AuthEvent): DirectoryEntry | null {
  if (event.type !== "identity.registered") return null;
  const email = event.payload.email;
  const subjectId = event.payload.subjectId;
  const record = event.payload.record;
  if (
    typeof email !== "string" ||
    typeof subjectId !== "string" ||
    !recordFromEvent(record, "subject", subjectId) ||
    record.primaryEmail !== email
  ) {
    throw new Error(`Malformed identity directory event ${event.eventId}`);
  }
  return { email, subjectId: subjectId as SubjectId, record };
}

async function directoryEntries(): Promise<DirectoryEntry[]> {
  const events = await store().listEvents(DIRECTORY_AGGREGATE);
  assertNoConflictingAggregateRevisions(events);
  assertUniqueDirectoryRegistrations(events);
  return events.flatMap((event) => {
    const entry = directoryEntry(event);
    return entry ? [entry] : [];
  });
}

async function loadSubjectByEmailUnlocked(email: string): Promise<SubjectRecord | null> {
  const entry = (await directoryEntries()).find((candidate) => candidate.email === email);
  if (!entry) return null;
  const current = await loadRecord("subject", entry.subjectId);
  if (current) return current.record;
  await persistRecord(entry.record, "identity.registration.recovered", systemActor());
  return entry.record;
}

async function loadSubjectUnlocked(subjectId: string): Promise<SubjectRecord | null> {
  const value = await loadRecord("subject", subjectId);
  return value?.record ?? null;
}

export async function registerAccount(
  emailInput: string,
  password: string,
): Promise<SubjectRecord> {
  const email = canonicalEmail(emailInput);
  const passwordCredential = await createPasswordCredential(password);
  return authMutationQueue.run(async () => {
    if (await loadSubjectByEmailUnlocked(email)) {
      throw new Error("An account with this email address already exists.");
    }
    const now = new Date().toISOString();
    const subject: SubjectRecord = {
      kind: "subject",
      schemaVersion: 1,
      subjectId: newSubjectId(),
      status: "active",
      primaryEmail: email,
      emailVerifiedAt: null,
      passwordCredential,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    const directoryEvents = await store().listEvents(DIRECTORY_AGGREGATE);
    assertNoConflictingAggregateRevisions(directoryEvents);
    assertUniqueDirectoryRegistrations(directoryEvents);
    const event: AuthEvent = {
      schemaVersion: 1,
      eventId: newEventId(),
      aggregate: DIRECTORY_AGGREGATE,
      aggregateVersion: Math.max(0, ...directoryEvents.map((item) => item.aggregateVersion)) + 1,
      occurredAt: now,
      actor: systemActor(),
      type: "identity.registered",
      payload: {
        email,
        subjectId: subject.subjectId,
        record: subject as unknown as JsonValue,
      },
    };
    await appendDirectoryRegistrationAndCheckIntegrity(store(), event);
    await persistRecord(subject, "identity.registered", {
      kind: "subject",
      subjectId: subject.subjectId,
    });
    return subject;
  });
}

export async function authenticate(emailInput: string, password: string): Promise<SubjectRecord> {
  const email = canonicalEmail(emailInput);
  const attempt = processLocalLoginThrottle.beginAttempt(email);
  try {
    const subject = await authMutationQueue.run(() => loadSubjectByEmailUnlocked(email));
    const matched = await verifyPassword(password, subject?.passwordCredential ?? null);
    if (!subject || subject.status !== "active" || !matched) {
      attempt.recordFailure();
      throw new Error("Email or password is incorrect.");
    }
    attempt.recordSuccess();
    return subject;
  } catch (error) {
    attempt.release();
    throw error;
  }
}

export async function createSession(
  subjectId: SubjectId,
): Promise<{ session: SessionRecord; token: string }> {
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    if (!subject || subject.status !== "active") throw new Error("This account cannot sign in.");
    const sessionId = newSessionId();
    const secret = randomBytes(32).toString("base64url");
    const token = `${sessionId}.${secret}`;
    const now = new Date();
    const session: SessionRecord = {
      kind: "session",
      schemaVersion: 1,
      sessionId,
      subjectId,
      verifierDigestHex: hashHex(token),
      authVersion: subject.authVersion,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
      revokedAt: null,
    };
    await persistRecord(session, "session.created", { kind: "subject", subjectId });
    return { session, token };
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_LIFETIME_MS / 1000,
    priority: "high" as const,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export interface AuthenticatedSession {
  session: SessionRecord;
  subject: SubjectRecord;
}

export async function getSessionFromToken(
  token: string | null | undefined,
): Promise<AuthenticatedSession | null> {
  if (!token) return null;
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/i.exec(token);
  if (!match) return null;
  try {
    assertOpaqueId(match[1]);
  } catch {
    return null;
  }
  return authMutationQueue.run(async () => {
    const session = await loadRecord("session", match[1] as SessionId);
    if (!session) return null;
    const record = session.record;
    if (
      record.revokedAt ||
      Date.parse(record.expiresAt) <= Date.now() ||
      !equalHex(record.verifierDigestHex, hashHex(token))
    )
      return null;
    const subject = await loadRecord("subject", record.subjectId);
    if (
      !subject ||
      subject.record.status !== "active" ||
      subject.record.authVersion !== record.authVersion
    )
      return null;
    return { session: record, subject: subject.record };
  });
}

export async function getCurrentSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  return getSessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function revokeSession(sessionId: string, actorSubjectId: SubjectId): Promise<void> {
  assertOpaqueId(sessionId);
  await authMutationQueue.run(async () => {
    const current = await loadRecord("session", sessionId);
    if (!current || current.record.subjectId !== actorSubjectId) return;
    if (current.record.revokedAt) return;
    const next: SessionRecord = { ...current.record, revokedAt: new Date().toISOString() };
    await persistRecord(next, "session.revoked", { kind: "subject", subjectId: actorSubjectId });
  });
}

export async function signOutCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  try {
    const current = await getSessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
    if (current) await revokeSession(current.session.sessionId, current.subject.subjectId);
  } finally {
    cookieStore.delete(SESSION_COOKIE);
  }
}

function configuredAdministrators(): Set<string> {
  return new Set(
    (process.env.PERMINISTER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function administratorEmailsConfigured(): boolean {
  return configuredAdministrators().size > 0;
}

export function isAdministrator(subject: SubjectRecord): boolean {
  return (
    !!subject.primaryEmail &&
    !!subject.emailVerifiedAt &&
    configuredAdministrators().has(subject.primaryEmail.toLowerCase())
  );
}

async function requireAdministrator(subjectId: SubjectId): Promise<SubjectRecord> {
  const actor = await loadSubjectUnlocked(subjectId);
  if (!actor || actor.status !== "active" || !isAdministrator(actor)) {
    throw new Error("Administrator access is required.");
  }
  return actor;
}

const ORGANIZATION_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface OrganizationSummary {
  organization: OrganizationRecord;
  membership: OrganizationMembershipRecord;
}

export interface OrganizationMemberView {
  membership: OrganizationMembershipRecord;
  email: string | null;
  emailVerified: boolean;
}

export interface OrganizationActivityEntry {
  eventId: EventId;
  type: string;
  occurredAt: string;
  actor: string;
  aggregateKind: string;
}

function organizationActivityEntry(event: AuthEvent): OrganizationActivityEntry {
  return {
    eventId: event.eventId,
    type: event.type,
    occurredAt: event.occurredAt,
    actor: event.actor.kind === "subject" ? "account" : event.actor.kind,
    aggregateKind: event.aggregate.kind,
  };
}

function requireVerifiedActiveSubject(
  subject: SubjectRecord | null,
): asserts subject is SubjectRecord {
  if (!subject || subject.status !== "active" || !subject.emailVerifiedAt) {
    throw new Error("An active, email-verified account is required.");
  }
}

function organizationName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80)
    throw new Error("Organization names must be 2 to 80 characters.");
  return name;
}

function organizationMemberships(
  subjectId: SubjectId,
  records: readonly OrganizationMembershipRecord[],
): OrganizationMembershipRecord[] {
  return records
    .filter((record) => record.subjectId === subjectId && record.status === "active")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function organizationMembershipUnlocked(
  organizationId: string,
  subjectId: SubjectId,
): Promise<OrganizationMembershipRecord | null> {
  const records = await listRecordsWithRecovery("organization-membership");
  return (
    records
      .map((item) => item.record)
      .find(
        (record) =>
          record.organizationId === organizationId &&
          record.subjectId === subjectId &&
          record.status === "active",
      ) ?? null
  );
}

async function requireOrganizationRoleUnlocked(
  actorId: SubjectId,
  organizationId: string,
  roles: readonly OrganizationRole[],
): Promise<OrganizationMembershipRecord> {
  assertOpaqueId(organizationId);
  const actor = await loadSubjectUnlocked(actorId);
  requireVerifiedActiveSubject(actor);
  const organization = await loadRecord("organization", organizationId);
  if (!organization) throw new Error("Organization not found.");
  const membership = await organizationMembershipUnlocked(organizationId, actorId);
  if (!membership || !roles.includes(membership.role)) {
    throw new Error("You do not have permission to manage this organization.");
  }
  return membership;
}

export async function createOrganization(
  subjectId: SubjectId,
  nameInput: string,
): Promise<OrganizationRecord> {
  const name = organizationName(nameInput);
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    requireVerifiedActiveSubject(subject);
    const now = new Date().toISOString();
    const organization: OrganizationRecord = {
      kind: "organization",
      schemaVersion: 1,
      organizationId: newOrganizationId(),
      name,
      createdBySubjectId: subjectId,
      createdAt: now,
      updatedAt: now,
    };
    await persistRecord(organization, "organization.created", { kind: "subject", subjectId });
    const membership: OrganizationMembershipRecord = {
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: newOrganizationMembershipId(),
      organizationId: organization.organizationId,
      subjectId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await persistRecord(membership, "organization.member-added", { kind: "subject", subjectId });
    return organization;
  });
}

export async function listOrganizationsForSubject(
  subjectId: SubjectId,
): Promise<OrganizationSummary[]> {
  return authMutationQueue.run(async () => {
    const records = (await listRecordsWithRecovery("organization-membership")).map(
      (item) => item.record,
    );
    const memberships = organizationMemberships(subjectId, records);
    const summaries: OrganizationSummary[] = [];
    for (const membership of memberships) {
      const organization = await loadRecord("organization", membership.organizationId);
      if (organization) summaries.push({ organization: organization.record, membership });
    }
    return summaries;
  });
}

export async function getOrganizationForSubject(
  subjectId: SubjectId,
  organizationId: string,
): Promise<OrganizationSummary> {
  return authMutationQueue.run(async () => {
    const membership = await organizationMembershipUnlocked(organizationId, subjectId);
    const organization = await loadRecord("organization", organizationId);
    if (!membership || !organization) throw new Error("Organization not found.");
    return { organization: organization.record, membership };
  });
}

export async function updateOrganizationName(
  actorId: SubjectId,
  organizationId: string,
  nameInput: string,
): Promise<OrganizationRecord> {
  const name = organizationName(nameInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner"]);
      const current = await loadRecord("organization", organizationId);
      if (!current) throw new Error("Organization not found.");
      const next = { ...current.record, name, updatedAt: new Date().toISOString() };
      await persistRecord(next, "organization.updated", { kind: "subject", subjectId: actorId });
      return next;
    }),
  );
}

export async function listOrganizationMembers(
  actorId: SubjectId,
  organizationId: string,
): Promise<OrganizationMemberView[]> {
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const memberships = (await listRecordsWithRecovery("organization-membership"))
      .map((item) => item.record)
      .filter((record) => record.organizationId === organizationId && record.status === "active")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const result: OrganizationMemberView[] = [];
    for (const membership of memberships) {
      const subject = await loadSubjectUnlocked(membership.subjectId);
      result.push({
        membership,
        email: subject?.primaryEmail ?? null,
        emailVerified: !!subject?.emailVerifiedAt,
      });
    }
    return result;
  });
}

async function requireOrganizationOwnerAndMemberUnlocked(
  actorId: SubjectId,
  organizationId: string,
  membershipId: string,
  requireActive: boolean,
) {
  const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner"]);
  const membership = await loadRecord("organization-membership", membershipId);
  if (
    !membership ||
    membership.record.organizationId !== organizationId ||
    (requireActive && membership.record.status !== "active")
  ) {
    throw new Error("Organization member not found.");
  }
  return { actorMembership, membership: membership.record };
}

export async function updateOrganizationMemberRole(
  actorId: SubjectId,
  organizationId: string,
  membershipId: string,
  role: OrganizationRole,
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const { actorMembership, membership } = await requireOrganizationOwnerAndMemberUnlocked(
        actorId,
        organizationId,
        membershipId,
        true,
      );
      if (membership.role === role) return;
      const all = (await listRecordsWithRecovery("organization-membership")).map(
        (item) => item.record,
      );
      const owners = all.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.role === "owner" &&
          item.status === "active",
      );
      if (membership.role === "owner" && role !== "owner" && owners.length <= 1) {
        throw new Error("An organization must keep at least one owner.");
      }
      const next = { ...membership, role, updatedAt: new Date().toISOString() };
      await persistRecord(next, "organization.member-role-updated", {
        kind: "subject",
        subjectId: actorMembership.subjectId,
      });
    }),
  );
}

async function revokeSubjectOrganizationAccessUnlocked(
  subjectId: SubjectId,
  organizationId: string,
  actorId: SubjectId,
): Promise<void> {
  const grants = (await listRecordsWithRecovery("membership"))
    .map((item) => item.record)
    .filter(
      (grant) =>
        grant.subjectId === subjectId &&
        grant.scope.organizationId === organizationId &&
        grant.status === "active",
    );
  for (const grant of grants) {
    await persistRecord(
      { ...grant, status: "disabled", updatedAt: new Date().toISOString() },
      "organization.member-grants-revoked",
      { kind: "subject", subjectId: actorId },
    );
  }
  const keys = (await listRecordsWithRecovery("api-key"))
    .map((item) => item.record)
    .filter(
      (key) =>
        key.owner.kind === "subject" &&
        key.owner.subjectId === subjectId &&
        key.scope.organizationId === organizationId &&
        key.status === "active",
    );
  for (const key of keys) {
    await persistRecord(
      { ...key, status: "revoked", revokedAt: new Date().toISOString() },
      "organization.member-keys-revoked",
      { kind: "subject", subjectId: actorId },
    );
  }
}

export async function removeOrganizationMember(
  actorId: SubjectId,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const { actorMembership, membership } = await requireOrganizationOwnerAndMemberUnlocked(
        actorId,
        organizationId,
        membershipId,
        false,
      );
      if (membership.status === "active" && membership.role === "owner") {
        const owners = (await listRecordsWithRecovery("organization-membership"))
          .map((item) => item.record)
          .filter(
            (item) =>
              item.organizationId === organizationId &&
              item.role === "owner" &&
              item.status === "active",
          );
        if (owners.length <= 1) throw new Error("An organization must keep at least one owner.");
      }
      if (membership.status === "active") {
        await persistRecord(
          { ...membership, status: "disabled", updatedAt: new Date().toISOString() },
          "organization.member-removed",
          { kind: "subject", subjectId: actorMembership.subjectId },
        );
      }
      await revokeSubjectOrganizationAccessUnlocked(
        membership.subjectId,
        organizationId,
        actorMembership.subjectId,
      );
    }),
  );
}

function validateProductId(value: string): string {
  const productId = value.trim().toLowerCase();
  if (
    productId.length < 1 ||
    productId.length > 128 ||
    !/^[a-z0-9][a-z0-9._:-]*$/.test(productId)
  ) {
    throw new Error(
      "Use a product ID with letters, numbers, dots, underscores, colons, or hyphens.",
    );
  }
  return productId;
}

function validateProductUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Enter a valid ${label} URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  return url.toString();
}

export interface ProductDetailsInput {
  productId: string;
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl: string;
}

interface NormalizedProductDetails {
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl: string;
}

function normalizeProductDetails(
  input: Omit<ProductDetailsInput, "productId">,
): NormalizedProductDetails {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 120) throw new Error("Enter a product name up to 120 characters.");
  if (input.description.length > 500)
    throw new Error("The product description must be 500 characters or fewer.");
  return {
    name,
    description: input.description.trim(),
    websiteUrl: validateProductUrl(input.websiteUrl, "Website"),
    iconUrl: input.iconUrl.trim() ? validateProductUrl(input.iconUrl.trim(), "Icon") : "",
  };
}

export async function createOrganizationProduct(
  actorId: SubjectId,
  organizationId: string,
  input: ProductDetailsInput,
): Promise<ProductRecord> {
  const productId = validateProductId(input.productId);
  const details = normalizeProductDetails(input);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const manager = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const products = (await listRecordsWithRecovery("product")).map((item) => item.record);
      if (
        products.some(
          (product) => product.organizationId === organizationId && product.productId === productId,
        )
      ) {
        throw new Error("That product ID is already in use in this organization.");
      }
      const now = new Date().toISOString();
      const product: ProductRecord = {
        kind: "product",
        schemaVersion: 1,
        productRecordId: newProductRecordId(),
        organizationId: organizationId as OrganizationId,
        productId,
        ...details,
        createdBySubjectId: actorId,
        createdAt: now,
        updatedAt: now,
      };
      await persistRecord(product, "product.created", {
        kind: "subject",
        subjectId: manager.subjectId,
      });
      return product;
    }),
  );
}

export async function updateOrganizationProduct(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  input: Omit<ProductDetailsInput, "productId">,
): Promise<ProductRecord> {
  assertOpaqueId(productRecordId);
  const details = normalizeProductDetails(input);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const manager = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("product", productRecordId);
      if (!current || current.record.organizationId !== organizationId)
        throw new Error("Product not found.");
      const next: ProductRecord = {
        ...current.record,
        ...details,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "product.updated", {
        kind: "subject",
        subjectId: manager.subjectId,
      });
      return next;
    }),
  );
}

export async function listProductsForOrganization(
  subjectId: SubjectId,
  organizationId: string,
): Promise<ProductRecord[]> {
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(subjectId, organizationId, ["owner", "admin", "member"]);
    return (await listRecordsWithRecovery("product"))
      .map((item) => item.record)
      .filter((product) => product.organizationId === organizationId)
      .sort((left, right) => left.name.localeCompare(right.name));
  });
}

export async function getProductForOrganization(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(subjectId, organizationId, ["owner", "admin", "member"]);
    const products = (await listRecordsWithRecovery("product")).map((item) => item.record);
    const product = products.find(
      (item) => item.organizationId === organizationId && item.productId === productId,
    );
    if (!product) throw new Error("Product not found.");
    return product;
  });
}

export async function createOrganizationInvitation(
  actorId: SubjectId,
  organizationId: string,
  emailInput: string,
  role: "admin" | "member",
): Promise<{ invitation: OrganizationInvitationRecord; token: string; organizationName: string }> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      if (role === "admin" && actorMembership.role !== "owner") {
        throw new Error("Only an organization owner can invite an administrator.");
      }
      const organization = await loadRecord("organization", organizationId);
      if (!organization) throw new Error("Organization not found.");
      const target = await loadSubjectByEmailUnlocked(email);
      if (target && (await organizationMembershipUnlocked(organizationId, target.subjectId))) {
        throw new Error("This person is already a member of the organization.");
      }
      const invites = (await listRecordsWithRecovery("organization-invitation")).map(
        (item) => item.record,
      );
      for (const previous of invites.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.email === email &&
          !item.consumedAt &&
          !item.revokedAt,
      )) {
        await persistRecord(
          { ...previous, revokedAt: new Date().toISOString() },
          "organization.invitation-replaced",
          { kind: "subject", subjectId: actorId },
        );
      }
      const invitationId = newInvitationId();
      const token = `${invitationId}.${randomBytes(32).toString("base64url")}`;
      const now = new Date();
      const invitation: OrganizationInvitationRecord = {
        kind: "organization-invitation",
        schemaVersion: 1,
        invitationId,
        organizationId: organizationId as OrganizationId,
        email,
        role,
        verifierDigestHex: hashHex(token),
        createdBySubjectId: actorId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ORGANIZATION_INVITATION_LIFETIME_MS).toISOString(),
        consumedAt: null,
        revokedAt: null,
      };
      await persistRecord(invitation, "organization.invitation-created", {
        kind: "subject",
        subjectId: actorId,
      });
      return { invitation, token, organizationName: organization.record.name };
    }),
  );
}

export async function listOrganizationInvitations(
  actorId: SubjectId,
  organizationId: string,
): Promise<OrganizationInvitationRecord[]> {
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    return (await listRecordsWithRecovery("organization-invitation"))
      .map((item) => item.record)
      .filter(
        (invite) =>
          invite.organizationId === organizationId &&
          !invite.consumedAt &&
          !invite.revokedAt &&
          Date.parse(invite.expiresAt) > Date.now(),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export async function revokeOrganizationInvitation(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (!current || current.record.organizationId !== organizationId)
        throw new Error("Invitation not found.");
      if (current.record.consumedAt || current.record.revokedAt) return;
      await persistRecord(
        { ...current.record, revokedAt: new Date().toISOString() },
        "organization.invitation-revoked",
        { kind: "subject", subjectId: actorMembership.subjectId },
      );
    }),
  );
}

export async function acceptOrganizationInvitation(
  subjectId: SubjectId,
  token: string,
): Promise<OrganizationId> {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(token);
  if (!match) throw new Error("This invitation is invalid or expired.");
  assertOpaqueId(match[1]);
  return authMutationQueue.run(async () => {
    const initial = await loadRecord("organization-invitation", match[1]);
    if (!initial) throw new Error("This invitation is invalid or expired.");
    return withOrganizationMutationLock(initial.record.organizationId, async () => {
      const subject = await loadSubjectUnlocked(subjectId);
      if (!subject || subject.status !== "active" || !subject.primaryEmail)
        throw new Error("An active account is required to accept an invitation.");
      const current = await loadRecord("organization-invitation", match[1]);
      if (
        !current ||
        current.record.consumedAt ||
        current.record.revokedAt ||
        Date.parse(current.record.expiresAt) <= Date.now() ||
        current.record.email !== subject.primaryEmail.toLowerCase() ||
        !equalHex(current.record.verifierDigestHex, hashHex(token))
      ) {
        throw new Error(
          "This invitation is invalid or expired, or it was sent to another email address.",
        );
      }
      const existing = await organizationMembershipUnlocked(
        current.record.organizationId,
        subjectId,
      );
      if (!existing) {
        await revokeSubjectOrganizationAccessUnlocked(
          subjectId,
          current.record.organizationId,
          subjectId,
        );
        const now = new Date().toISOString();
        const membership: OrganizationMembershipRecord = {
          kind: "organization-membership",
          schemaVersion: 1,
          organizationMembershipId: newOrganizationMembershipId(),
          organizationId: current.record.organizationId,
          subjectId,
          role: current.record.role,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
        await persistRecord(membership, "organization.invitation-accepted", {
          kind: "subject",
          subjectId,
        });
      }
      if (!subject.emailVerifiedAt) {
        await persistRecord(
          {
            ...subject,
            emailVerifiedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "identity.email-verified-by-invitation",
          { kind: "subject", subjectId },
        );
      }
      await persistRecord(
        { ...current.record, consumedAt: new Date().toISOString() },
        "organization.invitation-consumed",
        { kind: "subject", subjectId },
      );
      return current.record.organizationId;
    });
  });
}

export async function listOrganizationPermissionGrants(
  subjectId: SubjectId,
  organizationId: string,
): Promise<MembershipRecord[]> {
  return authMutationQueue.run(async () => {
    const role = await requireOrganizationRoleUnlocked(subjectId, organizationId, [
      "owner",
      "admin",
      "member",
    ]);
    return (await listRecordsWithRecovery("membership"))
      .map((item) => item.record)
      .filter(
        (record) =>
          record.scope.organizationId === organizationId &&
          (role.role !== "member" || record.status === "active") &&
          (role.role !== "member" || record.subjectId === subjectId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export async function listOrganizationAudit(
  subjectId: SubjectId,
  organizationId: string,
): Promise<OrganizationActivityEntry[]> {
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(subjectId, organizationId, ["owner", "admin"]);
    const events = await store().listAllEvents();
    return events
      .filter((event) => {
        if (event.payload.organizationId === organizationId) return true;
        const record = event.payload.record;
        if (!record || typeof record !== "object" || Array.isArray(record)) return false;
        if ("organizationId" in record && record.organizationId === organizationId) return true;
        return (
          "scope" in record &&
          typeof record.scope === "object" &&
          record.scope !== null &&
          !Array.isArray(record.scope) &&
          "organizationId" in record.scope &&
          record.scope.organizationId === organizationId
        );
      })
      .slice(0, 100)
      .map(organizationActivityEntry);
  });
}

export async function listPlatformAudit(actorId: SubjectId): Promise<OrganizationActivityEntry[]> {
  return authMutationQueue.run(async () => {
    await requireAdministrator(actorId);
    return (await store().listAllEvents()).slice(0, 100).map(organizationActivityEntry);
  });
}

export async function retireLegacyAccess(
  actorId: SubjectId,
): Promise<{ grants: number; keys: number }> {
  return authMutationQueue.run(async () => {
    const actor = await requireAdministrator(actorId);
    const legacyMemberships = (await listRecordsWithRecovery("membership"))
      .map((item) => item.record)
      .filter((record) => record.status === "active" && !record.scope.organizationId);
    const legacyKeys = (await listRecordsWithRecovery("api-key"))
      .map((item) => item.record)
      .filter((record) => record.status === "active" && !record.scope.organizationId);
    for (const membership of legacyMemberships) {
      await persistRecord(
        { ...membership, status: "disabled", updatedAt: new Date().toISOString() },
        "migration.legacy-grant-disabled",
        { kind: "subject", subjectId: actor.subjectId },
      );
    }
    for (const key of legacyKeys) {
      await persistRecord(
        { ...key, status: "revoked", revokedAt: new Date().toISOString() },
        "migration.legacy-api-key-revoked",
        { kind: "subject", subjectId: actor.subjectId },
      );
    }
    return { grants: legacyMemberships.length, keys: legacyKeys.length };
  });
}

export async function previewLegacyAccessRetirement(
  actorId: SubjectId,
): Promise<{ grants: number; keys: number }> {
  return authMutationQueue.run(async () => {
    await requireAdministrator(actorId);
    const memberships = (await listRecordsWithRecovery("membership")).map((item) => item.record);
    const keys = (await listRecordsWithRecovery("api-key")).map((item) => item.record);
    return {
      grants: memberships.filter(
        (record) => record.status === "active" && !record.scope.organizationId,
      ).length,
      keys: keys.filter((record) => record.status === "active" && !record.scope.organizationId)
        .length,
    };
  });
}

export interface PublicAccount {
  subjectId: SubjectId;
  email: string | null;
  status: SubjectRecord["status"];
  emailVerified: boolean;
  administrator: boolean;
  createdAt: string;
}

function publicAccount(subject: SubjectRecord): PublicAccount {
  return {
    subjectId: subject.subjectId,
    email: subject.primaryEmail,
    status: subject.status,
    emailVerified: !!subject.emailVerifiedAt,
    administrator: isAdministrator(subject),
    createdAt: subject.createdAt,
  };
}

export async function currentAccountProfile(subject: SubjectRecord): Promise<PublicAccount> {
  return publicAccount(subject);
}

export async function listAccountsForAdministrator(actorId: SubjectId): Promise<PublicAccount[]> {
  return authMutationQueue.run(async () => {
    return listAccountsForAdministratorUnlocked(actorId);
  });
}

async function listAccountsForAdministratorUnlocked(actorId: SubjectId): Promise<PublicAccount[]> {
  await requireAdministrator(actorId);
  const entries = await directoryEntries();
  const accounts: PublicAccount[] = [];
  for (const entry of entries) {
    let subject = await loadSubjectUnlocked(entry.subjectId);
    if (!subject) {
      await persistRecord(entry.record, "identity.registration.recovered", systemActor());
      subject = entry.record;
    }
    accounts.push(publicAccount(subject));
  }
  return accounts.sort((left, right) => (left.email ?? "").localeCompare(right.email ?? ""));
}

export async function updateAccountStatus(
  actorId: SubjectId,
  subjectId: string,
  status: "active" | "disabled",
): Promise<void> {
  assertOpaqueId(subjectId);
  await authMutationQueue.run(async () => {
    const actor = await requireAdministrator(actorId);
    const current = await loadRecord("subject", subjectId);
    if (!current) throw new Error("Account not found.");
    if (
      status === "disabled" &&
      current.record.primaryEmail &&
      configuredAdministrators().has(current.record.primaryEmail.toLowerCase())
    ) {
      throw new Error(
        "Remove this address from PERMINISTER_ADMIN_EMAILS before disabling the account.",
      );
    }
    if (current.record.status === status) return;
    const next: SubjectRecord = {
      ...current.record,
      status,
      authVersion: current.record.authVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    await persistRecord(next, status === "disabled" ? "identity.disabled" : "identity.enabled", {
      kind: "subject",
      subjectId: actor.subjectId,
    });
  });
}

function validateScope(scope: ResourceScope): ResourceScope {
  const validPart = (value: string) =>
    value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  assertOpaqueId(scope.organizationId);
  if (!validPart(scope.productId)) throw new Error("Enter a valid product ID.");
  if (scope.kind === "project" && !validPart(scope.projectId))
    throw new Error("Enter a valid project ID.");
  if (scope.kind === "workspace" && !validPart(scope.workspaceId))
    throw new Error("Enter a valid workspace ID.");
  return scope;
}

function validateActions(actions: readonly string[]): string[] {
  const normalized = [...new Set(actions.map((action) => action.trim()).filter(Boolean))];
  if (
    normalized.length === 0 ||
    normalized.length > 32 ||
    normalized.some((action) => action.length > 64 || !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(action))
  ) {
    throw new Error("Enter 1 to 32 valid action names.");
  }
  return normalized;
}

async function requireOrganizationProductUnlocked(
  organizationId: string,
  productId: string,
): Promise<void> {
  const products = (await listRecordsWithRecovery("product")).map((item) => item.record);
  if (
    !products.some(
      (product) => product.organizationId === organizationId && product.productId === productId,
    )
  ) {
    throw new Error("Choose a product in this organization.");
  }
}

export async function createPermissionGrant(
  actorId: SubjectId,
  targetSubjectId: string,
  scopeInput: ResourceScope,
  actionsInput: readonly string[],
): Promise<MembershipRecord> {
  assertOpaqueId(targetSubjectId);
  const scope = validateScope(scopeInput);
  const actions = validateActions(actionsInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, scope.organizationId, [
        "owner",
        "admin",
      ]);
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      const target = await loadSubjectUnlocked(targetSubjectId);
      if (!target || target.status !== "active" || !target.emailVerifiedAt) {
        throw new Error("Choose an active, email-verified account.");
      }
      if (
        !(await organizationMembershipUnlocked(scope.organizationId, targetSubjectId as SubjectId))
      ) {
        throw new Error("Choose a member of this organization.");
      }
      const now = new Date().toISOString();
      const membership: MembershipRecord = {
        kind: "membership",
        schemaVersion: 1,
        membershipId: newMembershipId(),
        subjectId: target.subjectId,
        scope,
        grants: [{ scope, actions }],
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      await persistRecord(membership, "permission.granted", {
        kind: "subject",
        subjectId: actorMembership.subjectId,
      });
      return membership;
    }),
  );
}

export async function updateGrantStatus(
  actorId: SubjectId,
  membershipId: string,
  status: "active" | "disabled",
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(async () => {
    const initial = await loadRecord("membership", membershipId);
    if (!initial) throw new Error("Permission grant not found.");
    if (!initial.record.scope.organizationId)
      throw new Error("Legacy grants cannot be changed here.");
    await withOrganizationMutationLock(initial.record.scope.organizationId, async () => {
      const current = await loadRecord("membership", membershipId);
      if (!current || current.record.scope.organizationId !== initial.record.scope.organizationId)
        throw new Error("Permission grant not found.");
      const actorMembership = await requireOrganizationRoleUnlocked(
        actorId,
        current.record.scope.organizationId,
        ["owner", "admin"],
      );
      if (
        status === "active" &&
        !(await organizationMembershipUnlocked(
          current.record.scope.organizationId,
          current.record.subjectId,
        ))
      ) {
        throw new Error(
          "The person must be an active organization member before restoring access.",
        );
      }
      if (current.record.status === status) return;
      await persistRecord(
        { ...current.record, status, updatedAt: new Date().toISOString() },
        status === "disabled" ? "permission.revoked" : "permission.restored",
        { kind: "subject", subjectId: actorMembership.subjectId },
      );
    });
  });
}

async function listRecordsWithRecovery<Kind extends AuthRecordKind>(
  kind: Kind,
  knownEvents?: readonly AuthEvent[],
): Promise<VersionedRecord<AuthRecordFor<Kind>>[]> {
  const objectStore = store();
  const [snapshots, allEvents] = await Promise.all([
    objectStore.listRecords(kind),
    knownEvents ? Promise.resolve(knownEvents) : objectStore.listAllEvents(),
  ]);
  assertNoConflictingAggregateRevisions(allEvents);
  assertUniqueDirectoryRegistrations(allEvents);
  const ids = new Set<string>(snapshots.map((snapshot) => recordId(snapshot.record)));
  for (const event of allEvents) {
    if (event.aggregate.kind === kind) ids.add(event.aggregate.id);
  }
  const values: VersionedRecord<AuthRecordFor<Kind>>[] = [];
  for (const id of ids) {
    const record = await loadRecord(kind, id);
    if (record) values.push(record);
  }
  return values;
}

export async function listMembershipsForSubject(subjectId: SubjectId): Promise<MembershipRecord[]> {
  return authMutationQueue.run(() => listMembershipsForSubjectUnlocked(subjectId));
}

async function listMembershipsForSubjectUnlocked(
  subjectId: SubjectId,
): Promise<MembershipRecord[]> {
  return (await listRecordsWithRecovery("membership"))
    .map((item) => item.record)
    .filter((record) => record.subjectId === subjectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export interface CreateApiKeyOptions {
  scope: ResourceScope;
  actions: readonly string[];
  expiresAt: string | null;
  rotateFromApiKeyId?: string;
}

export interface CreatedApiKey {
  record: ApiKeyRecord;
  token: string;
  rotationWarning: string | null;
}

export async function createApiKeyForSubject(
  subjectId: SubjectId,
  options: CreateApiKeyOptions,
): Promise<CreatedApiKey> {
  const scope = validateScope(options.scope);
  const actions = validateActions(options.actions);
  if (
    options.expiresAt &&
    (!Number.isFinite(Date.parse(options.expiresAt)) || Date.parse(options.expiresAt) <= Date.now())
  ) {
    throw new Error("Choose a future expiration time.");
  }
  const rotateId = options.rotateFromApiKeyId;
  if (rotateId) assertOpaqueId(rotateId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const subject = await loadSubjectUnlocked(subjectId);
      if (!subject || subject.status !== "active" || !subject.emailVerifiedAt) {
        throw new Error("An active, email-verified account is required to create an API key.");
      }
      if (!(await organizationMembershipUnlocked(scope.organizationId, subjectId))) {
        throw new Error("Join this organization before creating an API key.");
      }
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      for (const action of actions) {
        if (!(await hasPermission(subjectId, scope, action))) {
          throw new Error("API keys can only include actions granted to your account.");
        }
      }
      let previous: ApiKeyRecord | null = null;
      if (rotateId) {
        const old = await loadRecord("api-key", rotateId);
        if (
          !old ||
          old.record.owner.kind !== "subject" ||
          old.record.owner.subjectId !== subjectId
        ) {
          throw new Error("Choose one of your own API keys to rotate.");
        }
        if (
          old.record.status !== "active" ||
          (old.record.expiresAt && Date.parse(old.record.expiresAt) <= Date.now())
        ) {
          throw new Error("Only an active, unexpired API key can be rotated.");
        }
        if (old.record.scope.organizationId !== scope.organizationId) {
          throw new Error("A key can only be rotated within its organization.");
        }
        previous = old.record;
      }
      const apiKeyId = newApiKeyId();
      const token = `pmk_${apiKeyId}_${randomBytes(32).toString("base64url")}`;
      const now = new Date().toISOString();
      const record: ApiKeyRecord = {
        kind: "api-key",
        schemaVersion: 1,
        apiKeyId,
        keyClass: "integration",
        owner: { kind: "subject", subjectId },
        scope,
        actions,
        verifier: { algorithm: "sha256", digestHex: hashHex(token) },
        status: "active",
        createdAt: now,
        expiresAt: options.expiresAt,
        revokedAt: null,
        rotatedFromApiKeyId: previous?.apiKeyId ?? null,
      };
      await persistRecord(record, previous ? "api-key.rotated.created" : "api-key.created", {
        kind: "subject",
        subjectId,
      });
      let rotationWarning: string | null = null;
      if (previous) {
        try {
          await persistRecord(
            { ...previous, status: "revoked", revokedAt: new Date().toISOString() },
            "api-key.rotated.revoked-previous",
            { kind: "subject", subjectId },
          );
        } catch {
          rotationWarning =
            "The new key was created, but the previous key could not be revoked. Revoke it from the key list.";
        }
      }
      return { record, token, rotationWarning };
    }),
  );
}

export async function listApiKeysForSubject(subjectId: SubjectId): Promise<ApiKeyRecord[]> {
  return authMutationQueue.run(() => listApiKeysForSubjectUnlocked(subjectId));
}

async function listApiKeysForSubjectUnlocked(subjectId: SubjectId): Promise<ApiKeyRecord[]> {
  return (await listRecordsWithRecovery("api-key"))
    .map((item) => item.record)
    .filter((record) => record.owner.kind === "subject" && record.owner.subjectId === subjectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function revokeApiKeyForSubject(actorId: SubjectId, apiKeyId: string): Promise<void> {
  assertOpaqueId(apiKeyId);
  await authMutationQueue.run(async () => {
    const actor = await loadSubjectUnlocked(actorId);
    if (!actor || actor.status !== "active") throw new Error("An active account is required.");
    const initial = await loadRecord("api-key", apiKeyId);
    if (!initial) throw new Error("API key not found.");
    const revoke = async () => {
      const current = await loadRecord("api-key", apiKeyId);
      if (!current) throw new Error("API key not found.");
      const ownsKey =
        current.record.owner.kind === "subject" && current.record.owner.subjectId === actorId;
      if (!ownsKey && !isAdministrator(actor)) throw new Error("You cannot revoke this API key.");
      if (current.record.status === "revoked") return;
      await persistRecord(
        { ...current.record, status: "revoked", revokedAt: new Date().toISOString() },
        "api-key.revoked",
        { kind: "subject", subjectId: actorId },
      );
    };
    if (initial.record.scope.organizationId) {
      await withOrganizationMutationLock(initial.record.scope.organizationId, revoke);
    } else {
      await revoke();
    }
  });
}

function scopeMatchesGrant(grantScope: ResourceScope, request: ResourceScope): boolean {
  if (
    grantScope.organizationId !== request.organizationId ||
    grantScope.productId !== request.productId
  )
    return false;
  if (grantScope.kind === "product") return true;
  if (grantScope.kind !== request.kind) return false;
  if (grantScope.kind === "project" && request.kind === "project")
    return grantScope.projectId === request.projectId;
  if (grantScope.kind === "workspace" && request.kind === "workspace")
    return grantScope.workspaceId === request.workspaceId;
  return false;
}

function keyScopeAllows(keyScope: ResourceScope, request: ResourceScope): boolean {
  if (
    keyScope.organizationId !== request.organizationId ||
    keyScope.productId !== request.productId
  )
    return false;
  if (keyScope.kind === "product") return true;
  if (keyScope.kind !== request.kind) return false;
  if (keyScope.kind === "project" && request.kind === "project")
    return keyScope.projectId === request.projectId;
  if (keyScope.kind === "workspace" && request.kind === "workspace")
    return keyScope.workspaceId === request.workspaceId;
  return false;
}

async function hasPermission(
  subjectId: SubjectId,
  scope: ResourceScope,
  action: string,
): Promise<boolean> {
  const memberships = await listMembershipsForSubjectUnlocked(subjectId);
  return memberships.some(
    (membership) =>
      membership.status === "active" &&
      membership.grants.some(
        (grant: PermissionGrant) =>
          scopeMatchesGrant(grant.scope, scope) && grant.actions.includes(action),
      ),
  );
}

export interface AuthorizationRequest {
  organizationId: string;
  productId: string;
  resourceKind: "product" | "project" | "workspace";
  resourceId?: string;
  action: string;
}

function requestScope(input: AuthorizationRequest): ResourceScope {
  if (input.resourceKind === "product")
    return validateScope({
      kind: "product",
      organizationId: input.organizationId as OrganizationId,
      productId: input.productId,
    });
  if (input.resourceKind === "project" && input.resourceId) {
    return validateScope({
      kind: "project",
      organizationId: input.organizationId as OrganizationId,
      productId: input.productId,
      projectId: input.resourceId,
    });
  }
  if (input.resourceKind === "workspace" && input.resourceId) {
    return validateScope({
      kind: "workspace",
      organizationId: input.organizationId as OrganizationId,
      productId: input.productId,
      workspaceId: input.resourceId,
    });
  }
  throw new Error("A valid resource kind and ID are required.");
}

function parseApiKeyId(token: string): ApiKeyId | null {
  const match = /^pmk_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/i.exec(token);
  if (!match) return null;
  try {
    assertOpaqueId(match[1]);
    return match[1] as ApiKeyId;
  } catch {
    return null;
  }
}

export async function authorizeApiKey(
  token: string,
  input: AuthorizationRequest,
): Promise<{ authorized: boolean; subjectId?: SubjectId }> {
  const keyId = parseApiKeyId(token);
  if (!keyId) return { authorized: false };
  const scope = requestScope(input);
  const action = validateActions([input.action])[0];
  const current = await loadRecord("api-key", keyId);
  if (!current) return { authorized: false };
  const key = current.record;
  if (
    key.status !== "active" ||
    (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) ||
    !equalHex(key.verifier.digestHex, hashHex(token)) ||
    !key.actions.includes(action) ||
    !keyScopeAllows(key.scope, scope) ||
    key.owner.kind !== "subject"
  )
    return { authorized: false };
  const subject = await loadRecord("subject", key.owner.subjectId);
  if (!subject || subject.record.status !== "active" || !subject.record.emailVerifiedAt) {
    return { authorized: false };
  }
  if (!(await organizationMembershipUnlocked(scope.organizationId, subject.record.subjectId)))
    return { authorized: false };
  const authorized = await hasPermission(subject.record.subjectId, scope, action);
  return authorized
    ? { authorized: true, subjectId: subject.record.subjectId }
    : { authorized: false };
}

export async function issueEmailAction(
  subjectId: SubjectId,
  purpose: EmailActionRecord["purpose"],
): Promise<{ email: string; token: string } | null> {
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    if (!subject || subject.status !== "active" || !subject.primaryEmail) return null;
    if (purpose === "verify-email" && subject.emailVerifiedAt) return null;
    const actionId = newEmailActionId();
    const secret = randomBytes(32).toString("base64url");
    const token = `${actionId}.${secret}`;
    const now = new Date();
    const record: EmailActionRecord = {
      kind: "email-action",
      schemaVersion: 1,
      actionId,
      subjectId,
      purpose,
      verifierDigestHex: hashHex(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EMAIL_ACTION_LIFETIME_MS).toISOString(),
      consumedAt: null,
    };
    await persistRecord(record, `email.${purpose}.issued`, { kind: "subject", subjectId });
    return { email: subject.primaryEmail, token };
  });
}

export async function issueRecoveryAction(
  emailInput: string,
): Promise<{ email: string; token: string } | null> {
  const email = canonicalEmail(emailInput);
  const subject = await authMutationQueue.run(() => loadSubjectByEmailUnlocked(email));
  if (!subject) return null;
  return issueEmailAction(subject.subjectId, "recover-password");
}

export async function completeEmailAction(
  token: string,
  purpose: EmailActionRecord["purpose"],
  newPassword?: string,
): Promise<void> {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/i.exec(token);
  if (!match) throw new InvalidAuthActionError();
  let passwordCredential: PasswordCredential | undefined;
  if (purpose === "recover-password") {
    if (!newPassword) throw new Error("Enter a new password.");
    passwordCredential = await createPasswordCredential(newPassword);
  }
  await authMutationQueue.run(async () => {
    const currentAction = await loadRecord("email-action", match[1] as EmailActionId);
    if (
      !currentAction ||
      currentAction.record.purpose !== purpose ||
      currentAction.record.consumedAt ||
      Date.parse(currentAction.record.expiresAt) <= Date.now() ||
      !equalHex(currentAction.record.verifierDigestHex, hashHex(token))
    )
      throw new InvalidAuthActionError();
    const currentSubject = await loadRecord("subject", currentAction.record.subjectId);
    if (!currentSubject || currentSubject.record.status !== "active")
      throw new InvalidAuthActionError();
    const subject = currentSubject.record;
    let nextSubject = subject;
    if (purpose === "verify-email") {
      if (!subject.emailVerifiedAt) {
        nextSubject = {
          ...subject,
          emailVerifiedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
    } else {
      nextSubject = {
        ...subject,
        passwordCredential: passwordCredential!,
        emailVerifiedAt: subject.emailVerifiedAt ?? new Date().toISOString(),
        authVersion: subject.authVersion + 1,
        updatedAt: new Date().toISOString(),
      };
    }
    await persistRecord(
      { ...currentAction.record, consumedAt: new Date().toISOString() },
      `email.${purpose}.consumed`,
      { kind: "subject", subjectId: subject.subjectId },
    );
    if (nextSubject !== subject) {
      await persistRecord(
        nextSubject,
        purpose === "verify-email" ? "identity.email-verified" : "credential.password-reset",
        { kind: "subject", subjectId: subject.subjectId },
      );
    }
  });
}

export async function listSessionsForSubject(subjectId: SubjectId): Promise<SessionRecord[]> {
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    if (!subject) return [];
    return listSessionsForSubjectUnlocked(subject, undefined);
  });
}

async function listSessionsForSubjectUnlocked(
  subject: SubjectRecord,
  events: readonly AuthEvent[] | undefined,
): Promise<SessionRecord[]> {
  return (await listRecordsWithRecovery("session", events))
    .map((item) => item.record)
    .filter(
      (record) =>
        record.subjectId === subject.subjectId &&
        record.authVersion === subject.authVersion &&
        !record.revokedAt &&
        Date.parse(record.expiresAt) > Date.now(),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export interface AuditEntry {
  eventId: EventId;
  type: string;
  occurredAt: string;
  actor: string;
  aggregateKind: string;
}

export async function listAuditForSubject(subject: SubjectRecord): Promise<AuditEntry[]> {
  return auditEntriesForEvents(await store().listAllEvents(), subject);
}

function auditEntriesForEvents(events: readonly AuthEvent[], subject: SubjectRecord): AuditEntry[] {
  const administrator = isAdministrator(subject);
  return events
    .filter((event) => {
      if (administrator) return true;
      if (event.actor.kind === "subject" && event.actor.subjectId === subject.subjectId)
        return true;
      const record = event.payload.record;
      return (
        typeof record === "object" &&
        record !== null &&
        "subjectId" in record &&
        record.subjectId === subject.subjectId
      );
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

export interface DashboardData {
  memberships: MembershipRecord[];
  apiKeys: ApiKeyRecord[];
  sessions: SessionRecord[];
  audit: AuditEntry[];
  accounts: PublicAccount[] | null;
}

export async function loadDashboardData(subject: SubjectRecord): Promise<DashboardData> {
  return authMutationQueue.run(async () => {
    const events = await store().listAllEvents();
    const [membershipRecords, keyRecords, sessions, accounts] = await Promise.all([
      listRecordsWithRecovery("membership", events),
      listRecordsWithRecovery("api-key", events),
      listSessionsForSubjectUnlocked(subject, events),
      isAdministrator(subject)
        ? listAccountsForAdministratorUnlocked(subject.subjectId)
        : Promise.resolve(null),
    ]);
    const memberships = membershipRecords
      .map((item) => item.record)
      .filter((record) => isAdministrator(subject) || record.subjectId === subject.subjectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const apiKeys = keyRecords
      .map((item) => item.record)
      .filter(
        (record) => record.owner.kind === "subject" && record.owner.subjectId === subject.subjectId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      memberships,
      apiKeys,
      sessions,
      audit: auditEntriesForEvents(events, subject),
      accounts,
    };
  });
}

export async function getSubjectById(subjectId: string): Promise<SubjectRecord | null> {
  assertOpaqueId(subjectId);
  return authMutationQueue.run(() => loadSubjectUnlocked(subjectId));
}

export async function findAccountByEmail(emailInput: string): Promise<SubjectRecord | null> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() => loadSubjectByEmailUnlocked(email));
}
