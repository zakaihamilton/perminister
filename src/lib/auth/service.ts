import "server-only";

import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { cookies } from "next/headers";
import { authMutationQueue } from "./mutation-queue";
import { withOrganizationMutationLock } from "./coordination";
import { processLocalLoginThrottle } from "./login-throttle";
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
  newServicePrincipalId,
  newSubjectId,
  type ApiKeyId,
  type ApiKeyRecord,
  type AuthActor,
  type AuthAggregate,
  type AuthEvent,
  type AuthRecord,
  type AuthRecordFor,
  type AuthRecordKind,
  type EmailActionId,
  type EmailActionRecord,
  type EventId,
  type InvitationId,
  type MembershipId,
  type MembershipRecord,
  type OrganizationId,
  type OrganizationApprovalStatus,
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
  type ServicePrincipalId,
  type ServicePrincipalRecord,
  type JsonValue,
} from "./domain";
import { createSpacesAuthStoreFromEnv, type VersionedRecord } from "./storage/spaces";

const SESSION_COOKIE = "perminister_session";
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const EMAIL_ACTION_LIFETIME_MS = 30 * 60 * 1000;
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
    case "service-principal":
      return record.servicePrincipalId;
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
    case "service-principal":
      return { kind, id: id as ServicePrincipalId };
    case "api-key":
      return { kind, id: id as ApiKeyId };
    case "session":
      return { kind, id: id as SessionId };
    case "email-action":
      return { kind, id: id as EmailActionId };
  }
}

async function loadRecord<Kind extends AuthRecordKind>(
  kind: Kind,
  id: string,
): Promise<VersionedRecord<AuthRecordFor<Kind>> | null> {
  return store().readRecord(kind, id);
}

function activityPayload(record: AuthRecord): AuthEvent["payload"] {
  const payload: AuthEvent["payload"] = {};
  if (record.kind === "organization") {
    payload.organizationId = record.organizationId;
  } else if (record.kind === "organization-membership") {
    payload.organizationId = record.organizationId;
    payload.subjectId = record.subjectId;
    if (record.productId) payload.productId = record.productId;
  } else if (record.kind === "product") {
    payload.organizationId = record.organizationId;
    payload.productId = record.productId;
  } else if (record.kind === "organization-invitation") {
    payload.organizationId = record.organizationId;
    if (record.productId) payload.productId = record.productId;
    payload.subjectId = record.createdBySubjectId;
  } else if (record.kind === "membership") {
    payload.organizationId = record.scope.organizationId;
    payload.productId = record.scope.productId;
    payload.subjectId = record.subjectId;
  } else if (record.kind === "service-principal") {
    payload.organizationId = record.organizationId;
    payload.productId = record.productId;
    payload.subjectId = record.createdBySubjectId;
  } else if (record.kind === "api-key") {
    payload.organizationId = record.scope.organizationId;
    payload.productId = record.scope.productId;
    if (record.owner.kind === "subject") payload.subjectId = record.owner.subjectId;
  } else if (record.kind === "session" || record.kind === "email-action") {
    payload.subjectId = record.subjectId;
  } else {
    payload.subjectId = record.subjectId;
  }
  return payload;
}

async function persistRecord(record: AuthRecord, type: string, actor: AuthActor): Promise<void> {
  const objectStore = store();
  const id = recordId(record);
  const aggregate = aggregateFor(record.kind, id);
  const now = new Date().toISOString();
  if (record.kind === "membership") {
    const productMembership = await objectStore.readOrganizationMembership(
      record.scope.organizationId,
      record.subjectId,
      record.scope.productId,
    );
    if (!productMembership) throw new Error("Product membership not found.");
    const grants = productMembership.permissionGrants ?? [];
    const nextGrants = grants.some((grant) => grant.membershipId === record.membershipId)
      ? grants.map((grant) => (grant.membershipId === record.membershipId ? record : grant))
      : [...grants, record];
    await objectStore.writeRecord({
      ...productMembership,
      permissionGrants: nextGrants,
      updatedAt: now,
    });
  } else {
    await objectStore.writeRecord(record);
  }
  const event: AuthEvent = {
    schemaVersion: 1,
    eventId: newEventId(),
    aggregate,
    aggregateVersion: 1,
    occurredAt: now,
    actor,
    type,
    payload: activityPayload(record),
  };
  try {
    await objectStore.appendEvent(event);
  } catch (error) {
    console.error("Canonical auth record committed but activity append failed", {
      kind: record.kind,
      id,
      eventId: event.eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadSubjectByEmailUnlocked(email: string): Promise<SubjectRecord | null> {
  const subjectId = await store().findSubjectIdByEmail(email);
  return subjectId ? loadSubjectUnlocked(subjectId) : null;
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

export async function changePasswordForSubject(
  subjectId: SubjectId,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await authMutationQueue.run(async () => {
    const current = await loadSubjectUnlocked(subjectId);
    if (!current || current.status !== "active")
      throw new Error("This account cannot change its password.");
    if (!(await verifyPassword(currentPassword, current.passwordCredential))) {
      throw new Error("Current password is incorrect.");
    }
    const passwordCredential = await createPasswordCredential(newPassword);
    const next: SubjectRecord = {
      ...current,
      passwordCredential,
      authVersion: current.authVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    await persistRecord(next, "credential.password-changed", {
      kind: "subject",
      subjectId,
    });
  });
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

export async function createConsumerSession(
  subjectId: SubjectId,
  clientId: string,
  productId: string,
): Promise<{ session: SessionRecord; token: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(clientId)) {
    throw new Error("Choose a valid application client.");
  }
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    requireVerifiedActiveSubject(subject);
    const sessionId = newSessionId();
    const token = `${sessionId}.${randomBytes(32).toString("base64url")}`;
    const now = new Date();
    const session: SessionRecord = {
      kind: "session",
      schemaVersion: 1,
      sessionId,
      subjectId,
      verifierDigestHex: hashHex(token),
      authVersion: subject.authVersion,
      applicationClientId: clientId,
      productId: normalizedProductId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
      revokedAt: null,
    };
    await persistRecord(session, "session.consumer-created", {
      kind: "subject",
      subjectId,
    });
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
  const current = await getSessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
  return current?.session.applicationClientId ? null : current;
}

export async function getConsumerSessionFromToken(
  token: string | null | undefined,
  clientId: string,
): Promise<AuthenticatedSession | null> {
  const current = await getSessionFromToken(token);
  if (!current || current.session.applicationClientId !== clientId || !current.session.productId) {
    return null;
  }
  return current;
}

export async function revokeConsumerSession(
  token: string | null | undefined,
  clientId: string,
): Promise<void> {
  const current = await getConsumerSessionFromToken(token, clientId);
  if (current) await revokeSession(current.session.sessionId, current.subject.subjectId);
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
  catalogManager: boolean;
}

export interface OrganizationRequestSummary {
  organization: OrganizationRecord;
  status: "pending" | "rejected";
}

export interface OrganizationReviewRequest {
  organizationId: OrganizationId;
  name: string;
  requesterEmail: string | null;
  createdAt: string;
}

export interface OrganizationMemberView {
  membership: OrganizationMembershipRecord;
  email: string | null;
  emailVerified: boolean;
}

export interface ProductMemberView {
  membership: OrganizationMembershipRecord;
  email: string | null;
  emailVerified: boolean;
}

export interface ProductAccessSummary {
  product: ProductRecord;
  membership: OrganizationMembershipRecord | null;
  catalogManager: boolean;
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

function organizationApprovalStatus(organization: OrganizationRecord): OrganizationApprovalStatus {
  return organization.approvalStatus === undefined ? "approved" : organization.approvalStatus;
}

async function loadApprovedOrganizationUnlocked(
  organizationId: string,
): Promise<OrganizationRecord | null> {
  const organization = await loadRecord("organization", organizationId);
  if (!organization || organizationApprovalStatus(organization.record) !== "approved") return null;
  return organization.record;
}

async function listOrganizationRequestsForSubjectUnlocked(
  subjectId: SubjectId,
): Promise<OrganizationRequestSummary[]> {
  const organizations = (await listRecordsWithRecovery("organization"))
    .map((item) => item.record)
    .filter((organization) => organization.createdBySubjectId === subjectId)
    .flatMap((organization) => {
      const status = organizationApprovalStatus(organization);
      return status === "pending" || status === "rejected" ? [{ organization, status }] : [];
    });
  return organizations.sort((left, right) =>
    right.organization.createdAt.localeCompare(left.organization.createdAt),
  );
}

async function organizationMembershipUnlocked(
  organizationId: string,
  subjectId: SubjectId,
): Promise<OrganizationMembershipRecord | null> {
  const membership = await store().readOrganizationMembership(organizationId, subjectId);
  return membership?.status === "active" ? membership : null;
}

async function requireOrganizationRoleUnlocked(
  actorId: SubjectId,
  organizationId: string,
  roles: readonly OrganizationRole[],
): Promise<OrganizationMembershipRecord> {
  assertOpaqueId(organizationId);
  const actor = await loadSubjectUnlocked(actorId);
  requireVerifiedActiveSubject(actor);
  const organization = await loadApprovedOrganizationUnlocked(organizationId);
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
    const pendingRequests = await listOrganizationRequestsForSubjectUnlocked(subjectId);
    if (pendingRequests.some((request) => request.status === "pending")) {
      throw new Error("An organization request is already pending.");
    }
    const now = new Date().toISOString();
    const organization: OrganizationRecord = {
      kind: "organization",
      schemaVersion: 1,
      organizationId: newOrganizationId(),
      name,
      approvalStatus: "pending",
      createdBySubjectId: subjectId,
      createdAt: now,
      updatedAt: now,
    };
    await persistRecord(organization, "organization.requested", { kind: "subject", subjectId });
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
    const memberships = (await store().listMembershipsForSubject(subjectId)).filter(
      (record) => record.status === "active",
    );
    const byOrganization = new Map<string, OrganizationMembershipRecord[]>();
    for (const membership of memberships) {
      const entries = byOrganization.get(membership.organizationId) ?? [];
      entries.push(membership);
      byOrganization.set(membership.organizationId, entries);
    }
    const summaries: OrganizationSummary[] = [];
    for (const [organizationId, entries] of byOrganization) {
      const organization = await loadRecord("organization", organizationId);
      if (organization && organizationApprovalStatus(organization.record) === "approved") {
        const catalogManager = entries.find((membership) => !membership.productId);
        const productMember = entries.find((membership) => membership.productId);
        if (catalogManager)
          summaries.push({
            organization: organization.record,
            membership: catalogManager,
            catalogManager: true,
          });
        else if (productMember) {
          summaries.push({
            organization: organization.record,
            membership: {
              ...productMember,
              role: "member",
              productId: undefined,
              permissionGrants: undefined,
            },
            catalogManager: false,
          });
        }
      }
    }
    return summaries.sort((left, right) =>
      left.organization.name.localeCompare(right.organization.name),
    );
  });
}

export async function listOrganizationRequestsForSubject(
  subjectId: SubjectId,
): Promise<OrganizationRequestSummary[]> {
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    if (!subject || subject.status !== "active") {
      throw new Error("An active account is required.");
    }
    return listOrganizationRequestsForSubjectUnlocked(subjectId);
  });
}

export async function listPendingOrganizationsForAdministrator(
  actorId: SubjectId,
): Promise<OrganizationReviewRequest[]> {
  return authMutationQueue.run(async () => {
    await requireAdministrator(actorId);
    const organizations = (await listRecordsWithRecovery("organization"))
      .map((item) => item.record)
      .filter((organization) => organizationApprovalStatus(organization) === "pending")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const requests: OrganizationReviewRequest[] = [];
    for (const organization of organizations) {
      const requester = await loadSubjectUnlocked(organization.createdBySubjectId);
      requests.push({
        organizationId: organization.organizationId,
        name: organization.name,
        requesterEmail: requester?.primaryEmail ?? null,
        createdAt: organization.createdAt,
      });
    }
    return requests;
  });
}

export async function decideOrganizationRequest(
  actorId: SubjectId,
  organizationId: string,
  approvalStatus: "approved" | "rejected",
): Promise<void> {
  assertOpaqueId(organizationId);
  await authMutationQueue.run(async () => {
    const actor = await requireAdministrator(actorId);
    const current = await loadRecord("organization", organizationId);
    if (!current || organizationApprovalStatus(current.record) !== "pending") {
      throw new Error("Only pending organization requests can be reviewed.");
    }
    const next: OrganizationRecord = {
      ...current.record,
      approvalStatus,
      updatedAt: new Date().toISOString(),
    };
    await persistRecord(
      next,
      approvalStatus === "approved" ? "organization.approved" : "organization.rejected",
      { kind: "subject", subjectId: actor.subjectId },
    );
  });
}

export interface ConsumerOrganizationAccess {
  organizationId: OrganizationId;
  organizationName: string;
  organizationRole: OrganizationRole;
  productId: string;
  permissions: PermissionGrant[];
}

export async function listConsumerOrganizationsForSubject(
  subjectId: SubjectId,
  productId: string,
): Promise<ConsumerOrganizationAccess[]> {
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.run(async () => {
    const [organizationMemberships, products, grants] = await Promise.all([
      listRecordsWithRecovery("organization-membership"),
      listRecordsWithRecovery("product"),
      listRecordsWithRecovery("membership"),
    ]);
    const activeMemberships = organizationMemberships
      .map((item) => item.record)
      .filter((membership) => membership.subjectId === subjectId && membership.status === "active");
    const productRecords = products.map((item) => item.record);
    const subjectGrants = grants
      .map((item) => item.record)
      .filter((grant) => grant.subjectId === subjectId && grant.status === "active");
    const results: ConsumerOrganizationAccess[] = [];
    for (const membership of activeMemberships) {
      const product = productRecords.find(
        (candidate) =>
          candidate.organizationId === membership.organizationId &&
          candidate.productId === normalizedProductId,
      );
      if (!product) continue;
      const organization = await loadRecord("organization", membership.organizationId);
      if (!organization) continue;
      const permissions = subjectGrants
        .filter(
          (grant) =>
            grant.scope.organizationId === membership.organizationId &&
            grant.scope.productId === normalizedProductId,
        )
        .flatMap((grant) => grant.grants);
      results.push({
        organizationId: membership.organizationId,
        organizationName: organization.record.name,
        organizationRole: membership.role,
        productId: normalizedProductId,
        permissions,
      });
    }
    return results.sort((left, right) =>
      left.organizationName.localeCompare(right.organizationName),
    );
  });
}

export async function getOrganizationForSubject(
  subjectId: SubjectId,
  organizationId: string,
): Promise<OrganizationSummary> {
  return authMutationQueue.run(async () => {
    const catalogManager = await organizationMembershipUnlocked(organizationId, subjectId);
    const productMembership = catalogManager
      ? null
      : ((await store().listMembershipsForSubject(subjectId)).find(
          (entry) =>
            entry.organizationId === organizationId &&
            !!entry.productId &&
            entry.status === "active",
        ) ?? null);
    const organization = await loadRecord("organization", organizationId);
    if (
      (!catalogManager && !productMembership) ||
      !organization ||
      organizationApprovalStatus(organization.record) !== "approved"
    ) {
      throw new Error("Organization not found.");
    }
    const membership = catalogManager ?? {
      ...productMembership!,
      role: "member" as const,
      productId: undefined,
      permissionGrants: undefined,
    };
    return { organization: organization.record, membership, catalogManager: !!catalogManager };
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
      .filter(
        (record) =>
          record.organizationId === organizationId &&
          !record.productId &&
          record.status === "active",
      )
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
    !!membership.record.productId ||
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
  role: Exclude<OrganizationRole, "member">,
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
          !item.productId &&
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
              !item.productId &&
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
      const products = await store().listProducts(organizationId);
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
      const ownerMembership: OrganizationMembershipRecord = {
        kind: "organization-membership",
        schemaVersion: 1,
        organizationMembershipId: newOrganizationMembershipId(),
        organizationId: organizationId as OrganizationId,
        productId,
        subjectId: actorId,
        role: "owner",
        status: "active",
        permissionGrants: [],
        createdAt: now,
        updatedAt: now,
      };
      await persistRecord(ownerMembership, "product.owner-assigned", {
        kind: "subject",
        subjectId: actorId,
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
    const organization = await loadApprovedOrganizationUnlocked(organizationId);
    if (!organization) throw new Error("Organization not found.");
    const catalogManager = await organizationMembershipUnlocked(organizationId, subjectId);
    const memberRows = catalogManager ? [] : await store().listMembershipsForSubject(subjectId);
    const allowedProducts = new Set(
      memberRows
        .filter(
          (row) =>
            row.organizationId === organizationId && row.productId && row.status === "active",
        )
        .map((row) => row.productId!),
    );
    if (!catalogManager && allowedProducts.size === 0) throw new Error("Organization not found.");
    return (await store().listProducts(organizationId))
      .filter((product) => !!catalogManager || allowedProducts.has(product.productId))
      .sort((left, right) => left.name.localeCompare(right.name));
  });
}

export async function getProductForOrganization(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  return authMutationQueue.run(async () => {
    return getProductAccessUnlocked(subjectId, organizationId, productId).then(
      ({ product }) => product,
    );
  });
}

async function getProductAccessUnlocked(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductAccessSummary> {
  const organization = await loadApprovedOrganizationUnlocked(organizationId);
  if (!organization) throw new Error("Organization not found.");
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
  const [catalog, membership] = await Promise.all([
    organizationMembershipUnlocked(organizationId, subjectId),
    store().readOrganizationMembership(organizationId, subjectId, productId),
  ]);
  if (!catalog && (!membership || membership.status !== "active")) {
    throw new Error("Product not found.");
  }
  return {
    product,
    membership: membership?.status === "active" ? membership : null,
    catalogManager: !!catalog,
  };
}

export async function getProductAccessForSubject(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductAccessSummary> {
  return authMutationQueue.run(() =>
    getProductAccessUnlocked(subjectId, organizationId, productId),
  );
}

async function requireProductRoleUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  roles: readonly OrganizationRole[],
): Promise<OrganizationMembershipRecord> {
  assertOpaqueId(organizationId);
  const actor = await loadSubjectUnlocked(actorId);
  requireVerifiedActiveSubject(actor);
  if (!(await loadApprovedOrganizationUnlocked(organizationId)))
    throw new Error("Product not found.");
  if (!(await store().readProduct(organizationId, productId)))
    throw new Error("Product not found.");
  const membership = await store().readOrganizationMembership(organizationId, actorId, productId);
  if (!membership || membership.status !== "active" || !roles.includes(membership.role)) {
    throw new Error("You do not have permission to manage this product.");
  }
  return membership;
}

export async function listProductMembers(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ProductMemberView[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner", "admin"]);
    const memberships = (await store().listOrganizationMemberships(organizationId))
      .filter((record) => record.productId === productId && record.status === "active")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const result: ProductMemberView[] = [];
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

export async function listProductPermissionGrants(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<MembershipRecord[]> {
  return authMutationQueue.run(async () => {
    const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
      "owner",
      "admin",
      "member",
    ]);
    return (await store().listOrganizationMemberships(organizationId))
      .filter((membership) => membership.productId === productId)
      .flatMap((membership) => membership.permissionGrants ?? [])
      .filter(
        (grant) =>
          grant.scope.productId === productId &&
          (actor.role !== "member" || grant.subjectId === actorId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export async function updateProductMemberRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
  role: OrganizationRole,
): Promise<void> {
  assertOpaqueId(subjectId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const owner = await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner"]);
      const current = await store().readOrganizationMembership(
        organizationId,
        subjectId as SubjectId,
        productId,
      );
      if (!current || current.status !== "active") throw new Error("Product member not found.");
      if (current.role === role) return;
      const members = await store().listOrganizationMemberships(organizationId);
      const owners = members.filter(
        (membership) =>
          membership.productId === productId &&
          membership.role === "owner" &&
          membership.status === "active",
      );
      if (current.role === "owner" && role !== "owner" && owners.length <= 1) {
        throw new Error("A product must keep at least one owner.");
      }
      await persistRecord(
        { ...current, role, updatedAt: new Date().toISOString() },
        "product.member-role-updated",
        { kind: "subject", subjectId: owner.subjectId },
      );
    }),
  );
}

export async function removeProductMember(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
): Promise<void> {
  assertOpaqueId(subjectId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const owner = await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner"]);
      const current = await store().readOrganizationMembership(
        organizationId,
        subjectId as SubjectId,
        productId,
      );
      if (!current) throw new Error("Product member not found.");
      if (current.status === "active" && current.role === "owner") {
        const owners = (await store().listOrganizationMemberships(organizationId)).filter(
          (membership) =>
            membership.productId === productId &&
            membership.role === "owner" &&
            membership.status === "active",
        );
        if (owners.length <= 1) throw new Error("A product must keep at least one owner.");
      }
      if (current.status === "active") {
        const now = new Date().toISOString();
        const disabled = {
          ...current,
          status: "disabled" as const,
          permissionGrants: (current.permissionGrants ?? []).map((grant) => ({
            ...grant,
            status: "disabled" as const,
            updatedAt: now,
          })),
          updatedAt: now,
        };
        await persistRecord(disabled, "product.member-removed", {
          kind: "subject",
          subjectId: owner.subjectId,
        });
      }
      const keys = (await listRecordsWithRecovery("api-key"))
        .map((entry) => entry.record)
        .filter(
          (key) =>
            key.owner.kind === "subject" &&
            key.owner.subjectId === subjectId &&
            key.scope.organizationId === organizationId &&
            key.scope.productId === productId &&
            key.status === "active",
        );
      for (const key of keys) {
        await persistRecord(
          { ...key, status: "revoked", revokedAt: new Date().toISOString() },
          "product.member-keys-revoked",
          { kind: "subject", subjectId: owner.subjectId },
        );
      }
    }),
  );
}

export async function createOrganizationInvitation(
  actorId: SubjectId,
  organizationId: string,
  emailInput: string,
  role: "admin",
): Promise<{ invitation: OrganizationInvitationRecord; token: string; organizationName: string }> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      if (actorMembership.role !== "owner") {
        throw new Error("Only an organization owner can invite an administrator.");
      }
      const organization = await loadRecord("organization", organizationId);
      if (!organization) throw new Error("Organization not found.");
      const target = await loadSubjectByEmailUnlocked(email);
      if (target && (await organizationMembershipUnlocked(organizationId, target.subjectId))) {
        throw new Error("This person is already a catalog manager.");
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

export async function createProductInvitation(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  emailInput: string,
  role: "admin" | "member",
): Promise<{ invitation: OrganizationInvitationRecord; token: string; productName: string }> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      if (role === "admin" && actor.role !== "owner") {
        throw new Error("Only a product owner can invite a product administrator.");
      }
      const product = await store().readProduct(organizationId, productId);
      if (!product) throw new Error("Product not found.");
      const target = await loadSubjectByEmailUnlocked(email);
      if (target) {
        const existing = await store().readOrganizationMembership(
          organizationId,
          target.subjectId,
          productId,
        );
        if (existing?.status === "active")
          throw new Error("This person is already a product member.");
      }
      const invitations = (await listRecordsWithRecovery("organization-invitation"))
        .map((entry) => entry.record)
        .filter(
          (invite) =>
            invite.organizationId === organizationId &&
            invite.productId === productId &&
            invite.email === email &&
            !invite.consumedAt &&
            !invite.revokedAt,
        );
      for (const previous of invitations) {
        await persistRecord(
          { ...previous, revokedAt: new Date().toISOString() },
          "product.invitation-replaced",
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
        productId,
        email,
        role,
        verifierDigestHex: hashHex(token),
        createdBySubjectId: actorId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ORGANIZATION_INVITATION_LIFETIME_MS).toISOString(),
        consumedAt: null,
        revokedAt: null,
      };
      await persistRecord(invitation, "product.invitation-created", {
        kind: "subject",
        subjectId: actorId,
      });
      return { invitation, token, productName: product.name };
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
          !invite.productId &&
          !invite.consumedAt &&
          !invite.revokedAt &&
          Date.parse(invite.expiresAt) > Date.now(),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export async function listProductInvitations(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<OrganizationInvitationRecord[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner", "admin"]);
    return (await listRecordsWithRecovery("organization-invitation"))
      .map((entry) => entry.record)
      .filter(
        (invite) =>
          invite.organizationId === organizationId &&
          invite.productId === productId &&
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
      if (current.record.productId) throw new Error("Invitation not found.");
      if (current.record.consumedAt || current.record.revokedAt) return;
      await persistRecord(
        { ...current.record, revokedAt: new Date().toISOString() },
        "organization.invitation-revoked",
        { kind: "subject", subjectId: actorMembership.subjectId },
      );
    }),
  );
}

export async function revokeProductInvitation(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  invitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (
        !current ||
        current.record.organizationId !== organizationId ||
        current.record.productId !== productId
      ) {
        throw new Error("Invitation not found.");
      }
      if (current.record.consumedAt || current.record.revokedAt) return;
      await persistRecord(
        { ...current.record, revokedAt: new Date().toISOString() },
        "product.invitation-revoked",
        { kind: "subject", subjectId: actor.subjectId },
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
      if (!(await loadApprovedOrganizationUnlocked(current.record.organizationId))) {
        throw new Error(
          "This invitation is invalid or expired, or it was sent to another email address.",
        );
      }
      const existing = await store().readOrganizationMembership(
        current.record.organizationId,
        subjectId,
        current.record.productId,
      );
      if (!existing || existing.status !== "active") {
        const now = new Date().toISOString();
        const membership: OrganizationMembershipRecord = existing
          ? {
              ...existing,
              ...(current.record.productId
                ? {
                    productId: current.record.productId,
                    permissionGrants: existing.permissionGrants ?? [],
                  }
                : {}),
              role: current.record.productId ? current.record.role : "admin",
              status: "active",
              updatedAt: now,
            }
          : {
              kind: "organization-membership",
              schemaVersion: 1,
              organizationMembershipId: newOrganizationMembershipId(),
              organizationId: current.record.organizationId,
              ...(current.record.productId
                ? { productId: current.record.productId, permissionGrants: [] }
                : {}),
              subjectId,
              role: current.record.productId ? current.record.role : "admin",
              status: "active",
              createdAt: now,
              updatedAt: now,
            };
        await persistRecord(
          membership,
          current.record.productId
            ? "product.invitation-accepted"
            : "organization.catalog-manager-invitation-accepted",
          {
            kind: "subject",
            subjectId,
          },
        );
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
    const catalogManager = await organizationMembershipUnlocked(organizationId, subjectId);
    if (!catalogManager) {
      const memberships = await store().listMembershipsForSubject(subjectId);
      if (
        !memberships.some(
          (item) =>
            item.organizationId === organizationId && item.productId && item.status === "active",
        )
      ) {
        throw new Error("Organization not found.");
      }
    }
    const isCatalogManager = !!catalogManager;
    return (await store().listOrganizationMemberships(organizationId))
      .filter((membership) => !!membership.productId)
      .flatMap((membership) => membership.permissionGrants ?? [])
      .filter(
        (record) =>
          record.scope.organizationId === organizationId &&
          (isCatalogManager || record.subjectId === subjectId),
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
    return (await store().listOrganizationEvents(organizationId))
      .slice(0, 100)
      .map(organizationActivityEntry);
  });
}

export async function listProductAudit(
  subjectId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<OrganizationActivityEntry[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(subjectId, organizationId, productId, [
      "owner",
      "admin",
      "member",
    ]);
    return (await store().listOrganizationEvents(organizationId, productId))
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
  const accounts = (await listRecordsWithRecovery("subject"))
    .map((entry) => publicAccount(entry.record))
    .sort((left, right) => (left.email ?? "").localeCompare(right.email ?? ""));
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
  if (!(await store().readProduct(organizationId, productId))) {
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
      const actorMembership = await requireProductRoleUnlocked(
        actorId,
        scope.organizationId,
        scope.productId,
        ["owner", "admin"],
      );
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      const target = await loadSubjectUnlocked(targetSubjectId);
      if (!target || target.status !== "active" || !target.emailVerifiedAt) {
        throw new Error("Choose an active, email-verified account.");
      }
      const targetMembership = await store().readOrganizationMembership(
        scope.organizationId,
        targetSubjectId as SubjectId,
        scope.productId,
      );
      if (!targetMembership || targetMembership.status !== "active") {
        throw new Error("Choose a member of this product.");
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
      const actorMembership = await requireProductRoleUnlocked(
        actorId,
        current.record.scope.organizationId,
        current.record.scope.productId,
        ["owner", "admin"],
      );
      if (
        status === "active" &&
        (
          await store().readOrganizationMembership(
            current.record.scope.organizationId,
            current.record.subjectId,
            current.record.scope.productId,
          )
        )?.status !== "active"
      ) {
        throw new Error("The person must be an active product member before restoring access.");
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
): Promise<VersionedRecord<AuthRecordFor<Kind>>[]> {
  return store().listRecords(kind);
}

export async function listMembershipsForSubject(subjectId: SubjectId): Promise<MembershipRecord[]> {
  return authMutationQueue.run(() => listMembershipsForSubjectUnlocked(subjectId));
}

async function listMembershipsForSubjectUnlocked(
  subjectId: SubjectId,
): Promise<MembershipRecord[]> {
  return (await store().listMembershipsForSubject(subjectId))
    .flatMap((membership) => membership.permissionGrants ?? [])
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

export async function createServicePrincipal(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  nameInput: string,
): Promise<ServicePrincipalRecord> {
  const scope = validateScope({
    kind: "product",
    organizationId: organizationId as OrganizationId,
    productId,
  });
  const name = nameInput.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new Error("Integration names must be 2 to 80 characters.");
  }
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actor = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      await requireOrganizationProductUnlocked(organizationId, scope.productId);
      const now = new Date().toISOString();
      const principal: ServicePrincipalRecord = {
        kind: "service-principal",
        schemaVersion: 1,
        servicePrincipalId: newServicePrincipalId(),
        organizationId: scope.organizationId,
        productId: scope.productId,
        name,
        status: "active",
        createdBySubjectId: actor.subjectId,
        createdAt: now,
        updatedAt: now,
      };
      await persistRecord(principal, "service-principal.created", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return principal;
    }),
  );
}

export async function listServicePrincipalsForOrganization(
  actorId: SubjectId,
  organizationId: string,
  productId?: string,
): Promise<ServicePrincipalRecord[]> {
  const normalizedProductId = productId === undefined ? undefined : validateProductId(productId);
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    return (await listRecordsWithRecovery("service-principal"))
      .map((item) => item.record)
      .filter(
        (principal) =>
          principal.organizationId === organizationId &&
          (normalizedProductId === undefined || principal.productId === normalizedProductId),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  });
}

export async function updateServicePrincipalStatus(
  actorId: SubjectId,
  servicePrincipalId: string,
  status: "active" | "disabled",
  expectedProductId?: string,
): Promise<void> {
  assertOpaqueId(servicePrincipalId);
  const normalizedProductId =
    expectedProductId === undefined ? undefined : validateProductId(expectedProductId);
  const initial = await loadRecord("service-principal", servicePrincipalId);
  if (
    !initial ||
    (normalizedProductId !== undefined && initial.record.productId !== normalizedProductId)
  ) {
    throw new Error("Integration not found.");
  }
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(initial.record.organizationId, async () => {
      const actor = await requireOrganizationRoleUnlocked(actorId, initial.record.organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("service-principal", servicePrincipalId);
      if (
        !current ||
        current.record.organizationId !== initial.record.organizationId ||
        (normalizedProductId !== undefined && current.record.productId !== normalizedProductId)
      ) {
        throw new Error("Integration not found.");
      }
      if (current.record.status === status) return;
      const updated: ServicePrincipalRecord = {
        ...current.record,
        status,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(
        updated,
        status === "disabled" ? "service-principal.disabled" : "service-principal.enabled",
        { kind: "subject", subjectId: actor.subjectId },
      );
      if (status === "disabled") {
        const keys = (await listRecordsWithRecovery("api-key")).map((item) => item.record);
        for (const key of keys) {
          if (key.owner.kind !== "service" || key.owner.servicePrincipalId !== servicePrincipalId)
            continue;
          if (key.status === "revoked") continue;
          await persistRecord(
            { ...key, status: "revoked", revokedAt: new Date().toISOString() },
            "api-key.service-principal-disabled",
            { kind: "subject", subjectId: actor.subjectId },
          );
        }
      }
    }),
  );
}

export async function createApiKeyForServicePrincipal(
  actorId: SubjectId,
  servicePrincipalId: string,
  options: CreateApiKeyOptions,
): Promise<CreatedApiKey> {
  assertOpaqueId(servicePrincipalId);
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
      const actor = await requireOrganizationRoleUnlocked(actorId, scope.organizationId, [
        "owner",
        "admin",
      ]);
      const principal = await loadRecord("service-principal", servicePrincipalId);
      if (
        !principal ||
        principal.record.status !== "active" ||
        principal.record.organizationId !== scope.organizationId ||
        principal.record.productId !== scope.productId
      ) {
        throw new Error("Choose an active integration for this organization and product.");
      }
      let previous: ApiKeyRecord | null = null;
      if (rotateId) {
        const old = await loadRecord("api-key", rotateId);
        if (
          !old ||
          old.record.owner.kind !== "service" ||
          old.record.owner.servicePrincipalId !== servicePrincipalId
        ) {
          throw new Error("Choose one of this integration's API keys to rotate.");
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
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      const apiKeyId = newApiKeyId();
      const token = `pmk_${apiKeyId}_${randomBytes(32).toString("base64url")}`;
      const now = new Date().toISOString();
      const record: ApiKeyRecord = {
        kind: "api-key",
        schemaVersion: 1,
        apiKeyId,
        keyClass: "integration",
        owner: { kind: "service", servicePrincipalId: servicePrincipalId as ServicePrincipalId },
        scope,
        actions,
        verifier: { algorithm: "sha256", digestHex: hashHex(token) },
        status: "active",
        createdAt: now,
        expiresAt: options.expiresAt,
        revokedAt: null,
        rotatedFromApiKeyId: previous?.apiKeyId ?? null,
      };
      await persistRecord(
        record,
        previous ? "api-key.service-rotated.created" : "api-key.service-created",
        {
          kind: "subject",
          subjectId: actor.subjectId,
        },
      );
      let rotationWarning: string | null = null;
      if (previous) {
        try {
          await persistRecord(
            { ...previous, status: "revoked", revokedAt: new Date().toISOString() },
            "api-key.service-rotated.revoked-previous",
            { kind: "subject", subjectId: actor.subjectId },
          );
        } catch {
          rotationWarning =
            "The new key was created, but the previous key could not be revoked. Revoke it from the integration key list.";
        }
      }
      return { record, token, rotationWarning };
    }),
  );
}

export async function listApiKeysForServicePrincipal(
  actorId: SubjectId,
  servicePrincipalId: string,
  expectedProductId?: string,
): Promise<ApiKeyRecord[]> {
  assertOpaqueId(servicePrincipalId);
  const normalizedProductId =
    expectedProductId === undefined ? undefined : validateProductId(expectedProductId);
  return authMutationQueue.run(async () => {
    const principal = await loadRecord("service-principal", servicePrincipalId);
    if (
      !principal ||
      (normalizedProductId !== undefined && principal.record.productId !== normalizedProductId)
    ) {
      throw new Error("Integration not found.");
    }
    await requireOrganizationRoleUnlocked(actorId, principal.record.organizationId, [
      "owner",
      "admin",
    ]);
    return (await listRecordsWithRecovery("api-key"))
      .map((item) => item.record)
      .filter(
        (key) =>
          key.owner.kind === "service" && key.owner.servicePrincipalId === servicePrincipalId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export async function revokeServicePrincipalApiKey(
  actorId: SubjectId,
  servicePrincipalId: string,
  apiKeyId: string,
  expectedProductId?: string,
): Promise<void> {
  assertOpaqueId(servicePrincipalId);
  assertOpaqueId(apiKeyId);
  const normalizedProductId =
    expectedProductId === undefined ? undefined : validateProductId(expectedProductId);
  await authMutationQueue.run(async () => {
    const principal = await loadRecord("service-principal", servicePrincipalId);
    const key = await loadRecord("api-key", apiKeyId);
    if (
      !principal ||
      !key ||
      (normalizedProductId !== undefined && principal.record.productId !== normalizedProductId) ||
      key.record.owner.kind !== "service" ||
      key.record.owner.servicePrincipalId !== servicePrincipalId
    ) {
      throw new Error("Integration key not found.");
    }
    const actor = await requireOrganizationRoleUnlocked(actorId, principal.record.organizationId, [
      "owner",
      "admin",
    ]);
    if (key.record.status === "revoked") return;
    await persistRecord(
      { ...key.record, status: "revoked", revokedAt: new Date().toISOString() },
      "api-key.service-revoked",
      { kind: "subject", subjectId: actor.subjectId },
    );
  });
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
      if (!(await loadApprovedOrganizationUnlocked(scope.organizationId))) {
        throw new Error("Organization not found.");
      }
      const productMembership = await store().readOrganizationMembership(
        scope.organizationId,
        subjectId,
        scope.productId,
      );
      if (!productMembership || productMembership.status !== "active") {
        throw new Error("Join this product before creating an API key.");
      }
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      for (const action of actions) {
        if (!productMembershipHasPermission(productMembership, scope, action)) {
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

function productMembershipHasPermission(
  membership: OrganizationMembershipRecord,
  scope: ResourceScope,
  action: string,
): boolean {
  if (membership.status !== "active") return false;
  return (membership.permissionGrants ?? []).some(
    (grantRecord) =>
      grantRecord.status === "active" &&
      grantRecord.grants.some(
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
  applicationClientId?: string,
): Promise<{
  authorized: boolean;
  subjectId?: SubjectId;
  servicePrincipalId?: ServicePrincipalId;
}> {
  const keyId = parseApiKeyId(token);
  const scope = requestScope(input);
  const action = validateActions([input.action])[0];
  if (!keyId) {
    const currentSession = await getSessionFromToken(token);
    if (
      !currentSession ||
      !currentSession.session.applicationClientId ||
      !applicationClientId ||
      currentSession.session.applicationClientId !== applicationClientId ||
      currentSession.session.productId !== scope.productId
    ) {
      return { authorized: false };
    }
    return authMutationQueue.run(async () => {
      if (!(await loadApprovedOrganizationUnlocked(scope.organizationId))) {
        return { authorized: false };
      }
      const productMembership = await store().readOrganizationMembership(
        scope.organizationId,
        currentSession.subject.subjectId,
        scope.productId,
      );
      if (!productMembership || productMembership.status !== "active") {
        return { authorized: false };
      }
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      const authorized = productMembershipHasPermission(productMembership, scope, action);
      return authorized
        ? { authorized: true, subjectId: currentSession.subject.subjectId }
        : { authorized: false };
    });
  }
  const current = await loadRecord("api-key", keyId);
  if (!current) return { authorized: false };
  const key = current.record;
  if (
    key.status !== "active" ||
    (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) ||
    !equalHex(key.verifier.digestHex, hashHex(token)) ||
    !key.actions.includes(action) ||
    !keyScopeAllows(key.scope, scope)
  )
    return { authorized: false };
  if (key.owner.kind === "service") {
    const principal = await loadRecord("service-principal", key.owner.servicePrincipalId);
    if (
      !principal ||
      principal.record.status !== "active" ||
      principal.record.organizationId !== scope.organizationId ||
      principal.record.productId !== scope.productId
    ) {
      return { authorized: false };
    }
    await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
    return {
      authorized: true,
      servicePrincipalId: principal.record.servicePrincipalId,
    };
  }
  const subject = await loadRecord("subject", key.owner.subjectId);
  if (!subject || subject.record.status !== "active" || !subject.record.emailVerifiedAt) {
    return { authorized: false };
  }
  if (!(await loadApprovedOrganizationUnlocked(scope.organizationId))) {
    return { authorized: false };
  }
  const productMembership = await store().readOrganizationMembership(
    scope.organizationId,
    subject.record.subjectId,
    scope.productId,
  );
  if (!productMembership || productMembership.status !== "active") return { authorized: false };
  const authorized = productMembershipHasPermission(productMembership, scope, action);
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
    return listSessionsForSubjectUnlocked(subject);
  });
}

async function listSessionsForSubjectUnlocked(subject: SubjectRecord): Promise<SessionRecord[]> {
  return (await listRecordsWithRecovery("session"))
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
      listRecordsWithRecovery("membership"),
      listRecordsWithRecovery("api-key"),
      listSessionsForSubjectUnlocked(subject),
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
