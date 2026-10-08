import "server-only";

import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { verify as verifyArgon2id } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { cache } from "react";
import { mapWithConcurrency } from "./concurrency";
import { authMutationQueue } from "./mutation-queue";
import { withOrganizationMutationLock } from "./coordination";
import { processLocalLoginThrottle } from "./login-throttle";
import {
  assertOpaqueId,
  authRecordId,
  newApiKeyId,
  newConsumerClientId,
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
  type ApiKeyOwner,
  type ApiKeyRecord,
  type ConsumerClientId,
  type ConsumerClientRecord,
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
  type LegacyIdentitySource,
  type ConsumerLoginIdentifier,
  type ConsumerProductState,
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
  type ProductId,
  type ProductRecord,
  type ProductRecordId,
  type ProductVisibility,
  type ResourceScope,
  type SessionId,
  type SessionRecord,
  type SubjectId,
  type SubjectRecord,
  type ServicePrincipalId,
  type ServicePrincipalRecord,
} from "./domain";
import { createSpacesAuthStoreFromEnv, type VersionedRecord } from "./storage/spaces";
import type { ProductAccessRole } from "./access-roles";
import { consumerProductPolicy, consumerRoleActions, scopeResourceId } from "./consumer-policy";

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

function isEmailVerifiedOrExempt(subject: SubjectRecord): boolean {
  return (
    subject.primaryEmail === null || !!subject.emailVerifiedAt || !!subject.emailVerificationExempt
  );
}

function consumerProductState(subject: SubjectRecord, productId: string): ConsumerProductState {
  return (
    subject.consumerProductStates?.find((state) => state.productId === productId) ?? {
      productId,
      status: "active",
      sessionVersion: 1,
    }
  );
}

function updateConsumerProductState(
  subject: SubjectRecord,
  productId: string,
  status: "active" | "disabled",
  revokeSessions = false,
): ConsumerProductState[] {
  const current = consumerProductState(subject, productId);
  const next: ConsumerProductState = {
    productId,
    status,
    sessionVersion: current.sessionVersion + (current.status !== status || revokeSessions ? 1 : 0),
  };
  return [
    ...(subject.consumerProductStates ?? []).filter((state) => state.productId !== productId),
    next,
  ];
}

const PERSON_NAME_MAX_LENGTH = 80;

function normalizedPersonName(
  value: string | undefined,
  label: "First" | "Last",
): string | undefined {
  if (value === undefined) return undefined;
  const name = value.trim();
  if (name.length > PERSON_NAME_MAX_LENGTH) {
    throw new Error(`${label} name must be ${PERSON_NAME_MAX_LENGTH} characters or fewer.`);
  }
  return name || undefined;
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

function postParticleScrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      },
    );
  });
}

async function createPasswordCredential(password: string): Promise<PasswordCredential> {
  validatePassword(password);
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt);
  return {
    algorithm: "scrypt",
    format: "perminister-scrypt-v1",
    encodedVerifier: `scrypt$v=1$N=32768$r=8$p=1$${salt.toString("base64url")}$${digest.toString("base64url")}`,
    updatedAt: new Date().toISOString(),
  };
}

async function createAdminProvisionedSubject(
  email: string | null,
  password: string,
  actorId: SubjectId,
): Promise<SubjectRecord> {
  const now = new Date().toISOString();
  const subject: SubjectRecord = {
    kind: "subject",
    schemaVersion: 1,
    subjectId: newSubjectId(),
    status: "active",
    primaryEmail: email,
    emailVerifiedAt: null,
    emailVerificationExempt: true,
    loginIdentifiers: [],
    legacySources: [],
    passwordCredential: await createPasswordCredential(password),
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  await persistRecord(subject, "identity.admin-provisioned", {
    kind: "subject",
    subjectId: actorId,
  });
  return subject;
}

async function verifyPassword(
  password: string,
  credential: PasswordCredential | null,
): Promise<boolean> {
  if (!credential) {
    await scrypt(password, Buffer.alloc(16, 4));
    return false;
  }
  if (credential.algorithm === "argon2id") {
    if (!/^\$argon2id\$v=\d+\$/.test(credential.encodedVerifier)) {
      await scrypt(password, Buffer.alloc(16, 4));
      return false;
    }
    try {
      return await verifyArgon2id(credential.encodedVerifier, password);
    } catch {
      return false;
    }
  }
  if (
    credential.format === "postparticle-scrypt-v1" ||
    /^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(credential.encodedVerifier)
  ) {
    const match = /^([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(credential.encodedVerifier);
    if (!match) {
      await scrypt(password, Buffer.alloc(16, 4));
      return false;
    }
    try {
      const expected = Buffer.from(match[2], "hex");
      const actual = await postParticleScrypt(password, match[1]);
      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
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
    case "consumer-client":
      return { kind, id: id as ConsumerClientId };
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
  } else if (record.kind === "consumer-client") {
    if (record.organizationId) payload.organizationId = record.organizationId;
    payload.productId = record.productId;
    payload.subjectId = record.createdBySubjectId;
  } else if (record.kind === "session" || record.kind === "email-action") {
    payload.subjectId = record.subjectId;
  } else {
    payload.subjectId = record.subjectId;
  }
  return payload;
}

async function persistRecord(record: AuthRecord, type: string, actor: AuthActor): Promise<void> {
  const objectStore = store();
  const id = authRecordId(record);
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

async function loadSubjectByUsernameUnlocked(
  productId: string,
  username: string,
): Promise<SubjectRecord | null> {
  const subjectId = await store().findSubjectIdByUsername(productId, username);
  return subjectId ? loadSubjectUnlocked(subjectId) : null;
}

function normalizeProductUsername(value: string): string {
  const username = value.trim().toLowerCase();
  const validUsername = /^[a-z0-9][a-z0-9_-]{0,79}$/.test(username);
  const validEmail =
    username.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) &&
    !username.includes("..");
  if (!validUsername && !validEmail) throw new Error("Enter a valid product username.");
  return username;
}

function needsPasswordRehash(credential: PasswordCredential | null): boolean {
  return (
    !!credential &&
    (credential.algorithm !== "scrypt" ||
      (credential.format !== "perminister-scrypt-v1" &&
        !credential.encodedVerifier.startsWith("scrypt$v=1$N=32768$r=8$p=1$")))
  );
}

async function rehashAfterLogin(subject: SubjectRecord, verifiedPassword: string): Promise<void> {
  if (!needsPasswordRehash(subject.passwordCredential)) return;
  const passwordCredential = await createPasswordCredential(verifiedPassword);
  await authMutationQueue.run(async () => {
    const current = await loadSubjectUnlocked(subject.subjectId);
    if (
      !current ||
      current.status !== "active" ||
      current.passwordCredential?.encodedVerifier !== subject.passwordCredential?.encodedVerifier ||
      current.passwordCredential?.algorithm !== subject.passwordCredential?.algorithm
    ) {
      return;
    }
    await persistRecord(
      { ...current, passwordCredential, updatedAt: new Date().toISOString() },
      "credential.password-rehashed",
      { kind: "subject", subjectId: subject.subjectId },
    );
  });
}

async function loadSubjectUnlocked(subjectId: string): Promise<SubjectRecord | null> {
  const value = await loadRecord("subject", subjectId);
  return value?.record ?? null;
}

export async function registerAccount(
  emailInput: string,
  password: string,
  profile: { firstName?: string; lastName?: string } = {},
): Promise<SubjectRecord> {
  const email = canonicalEmail(emailInput);
  const firstName = normalizedPersonName(profile.firstName, "First");
  const lastName = normalizedPersonName(profile.lastName, "Last");
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
      firstName,
      lastName,
      primaryEmail: email,
      emailVerifiedAt: null,
      emailVerificationExempt: false,
      loginIdentifiers: [],
      legacySources: [],
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

export async function updateAccountProfile(
  subjectId: SubjectId,
  profile: { firstName: string; lastName: string },
): Promise<void> {
  const firstName = normalizedPersonName(profile.firstName, "First");
  const lastName = normalizedPersonName(profile.lastName, "Last");
  await authMutationQueue.run(async () => {
    const current = await loadSubjectUnlocked(subjectId);
    if (!current || current.status !== "active") {
      throw new Error("This account cannot update its profile.");
    }
    if (current.firstName === firstName && current.lastName === lastName) return;
    const next: SubjectRecord = {
      ...current,
      firstName,
      lastName,
      updatedAt: new Date().toISOString(),
    };
    await persistRecord(next, "identity.profile-updated", {
      kind: "subject",
      subjectId,
    });
  });
}

export async function authenticate(
  identifierInput: string,
  password: string,
  productId?: string,
): Promise<SubjectRecord> {
  const identifier = productId
    ? normalizeProductUsername(identifierInput)
    : canonicalEmail(identifierInput);
  const attempt = processLocalLoginThrottle.beginAttempt(
    productId ? `${productId}:${identifier}` : identifier,
  );
  try {
    const subject = await authMutationQueue.run(async () => {
      if (!productId) return loadSubjectByEmailUnlocked(identifier);
      const emailSubject = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
        ? await loadSubjectByEmailUnlocked(identifier)
        : null;
      const usernameSubject = await loadSubjectByUsernameUnlocked(productId, identifier);
      if (emailSubject && usernameSubject && emailSubject.subjectId !== usernameSubject.subjectId) {
        return null;
      }
      return emailSubject ?? usernameSubject;
    });
    const matched = await verifyPassword(password, subject?.passwordCredential ?? null);
    if (
      !subject ||
      subject.status !== "active" ||
      !matched ||
      (productId !== undefined && consumerProductState(subject, productId).status !== "active")
    ) {
      attempt.recordFailure();
      throw new Error("Email or password is incorrect.");
    }
    attempt.recordSuccess();
    await rehashAfterLogin(subject, password);
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
  sessionLifetimeMs = SESSION_LIFETIME_MS,
): Promise<{ session: SessionRecord; token: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(clientId)) {
    throw new Error("Choose a valid application client.");
  }
  const normalizedProductId = validateProductId(productId);
  if (
    !Number.isSafeInteger(sessionLifetimeMs) ||
    sessionLifetimeMs < 5 * 60 * 1000 ||
    sessionLifetimeMs > 90 * 24 * 60 * 60 * 1000
  ) {
    throw new Error("Choose a valid consumer session lifetime.");
  }
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    requireVerifiedActiveSubject(subject);
    const productState = consumerProductState(subject, normalizedProductId);
    if (productState.status !== "active") {
      throw new Error("This account is disabled for the application.");
    }
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
      productSessionVersion: productState.sessionVersion,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + sessionLifetimeMs).toISOString(),
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
  return authMutationQueue.read(async () => {
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
      subject.record.authVersion !== record.authVersion ||
      (!!record.productId &&
        (consumerProductState(subject.record, record.productId).status !== "active" ||
          consumerProductState(subject.record, record.productId).sessionVersion !==
            (record.productSessionVersion ?? 1)))
    )
      return null;
    return { session: record, subject: subject.record };
  });
}

export const getCurrentSession = cache(
  async function getCurrentSession(): Promise<AuthenticatedSession | null> {
    const cookieStore = await cookies();
    const current = await getSessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
    return current?.session.applicationClientId ? null : current;
  },
);

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
  catalogRole: OrganizationRole | null;
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
  if (!subject || subject.status !== "active" || !isEmailVerifiedOrExempt(subject)) {
    throw new Error("An active account with a verified email is required.");
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

export const listOrganizationsForSubject = cache(async function listOrganizationsForSubject(
  subjectId: SubjectId,
): Promise<OrganizationSummary[]> {
  return authMutationQueue.read(async () => {
    const memberships = (await store().listMembershipsForSubject(subjectId)).filter(
      (record) => record.status === "active",
    );
    const byOrganization = new Map<string, OrganizationMembershipRecord[]>();
    for (const membership of memberships) {
      const entries = byOrganization.get(membership.organizationId) ?? [];
      entries.push(membership);
      byOrganization.set(membership.organizationId, entries);
    }
    const summaries = await mapWithConcurrency<
      [string, OrganizationMembershipRecord[]],
      OrganizationSummary | null
    >([...byOrganization.entries()], async ([organizationId, entries]) => {
      const organization = await loadRecord("organization", organizationId);
      if (!organization || organizationApprovalStatus(organization.record) !== "approved") {
        return null;
      }
      const catalogManager = entries.find((membership) => !membership.productId);
      const productMember = entries.find((membership) => membership.productId);
      if (catalogManager) {
        return {
          organization: organization.record,
          membership: catalogManager,
          catalogManager: true,
        } satisfies OrganizationSummary;
      }
      if (productMember) {
        return {
          organization: organization.record,
          membership: {
            ...productMember,
            role: "member",
            productId: undefined,
            permissionGrants: undefined,
          },
          catalogManager: false,
        } satisfies OrganizationSummary;
      }
      return null;
    });
    return summaries
      .filter((summary): summary is OrganizationSummary => summary !== null)
      .sort((left, right) => left.organization.name.localeCompare(right.organization.name));
  });
});

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
  resourceRoles: Array<{
    scope: ResourceScope;
    role: string | null;
    actions: string[];
  }>;
  platformAdmin: boolean;
}

export async function listConsumerOrganizationsForSubject(
  subjectId: SubjectId,
  productId: string,
): Promise<ConsumerOrganizationAccess[]> {
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.run(async () => {
    const [organizationMemberships, grants] = await Promise.all([
      listRecordsWithRecovery("organization-membership"),
      listRecordsWithRecovery("membership"),
    ]);
    const activeMemberships = organizationMemberships
      .map((item) => item.record)
      .filter((membership) => membership.subjectId === subjectId && membership.status === "active");
    const subjectGrants = grants
      .map((item) => item.record)
      .filter((grant) => grant.subjectId === subjectId && grant.status === "active");
    const results: ConsumerOrganizationAccess[] = [];
    for (const membership of activeMemberships) {
      const product = await store().readProduct(membership.organizationId, normalizedProductId);
      if (!product) continue;
      const organization = await loadRecord("organization", membership.organizationId);
      if (!organization) continue;
      const scopedMemberships = subjectGrants.filter(
        (grant) =>
          grant.scope.organizationId === membership.organizationId &&
          grant.scope.productId === normalizedProductId,
      );
      const permissions = scopedMemberships.flatMap((grant) => grant.grants);
      results.push({
        organizationId: membership.organizationId,
        organizationName: organization.record.name,
        organizationRole: membership.role,
        productId: normalizedProductId,
        permissions,
        resourceRoles: scopedMemberships.map((grant) => ({
          scope: grant.scope,
          role: grant.accessRole?.name ?? null,
          actions: grant.grants.flatMap((permission) => [...permission.actions]),
        })),
        platformAdmin: scopedMemberships.some(
          (grant) => grant.scope.kind === "product" && grant.accessRole?.name === "platform-admin",
        ),
      });
    }
    return results.sort((left, right) =>
      left.organizationName.localeCompare(right.organizationName),
    );
  });
}

export const getOrganizationForSubject = cache(async function getOrganizationForSubject(
  subjectId: SubjectId,
  organizationId: string,
): Promise<OrganizationSummary> {
  return authMutationQueue.read(async () => {
    const [catalogManager, organization] = await Promise.all([
      organizationMembershipUnlocked(organizationId, subjectId),
      loadRecord("organization", organizationId),
    ]);
    const productMembership = catalogManager
      ? null
      : ((await store().listMembershipsForSubject(subjectId)).find(
          (entry) =>
            entry.organizationId === organizationId &&
            !!entry.productId &&
            entry.status === "active",
        ) ?? null);
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
});

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

export const listOrganizationMembers = cache(async function listOrganizationMembers(
  actorId: SubjectId,
  organizationId: string,
): Promise<OrganizationMemberView[]> {
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const memberships = (await store().listOrganizationMemberships(organizationId))
      .filter((record) => !record.productId && record.status === "active")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return mapWithConcurrency(memberships, async (membership) => {
      const subject = await loadSubjectUnlocked(membership.subjectId);
      return {
        membership,
        email: subject?.primaryEmail ?? null,
        emailVerified: !!subject?.emailVerifiedAt,
      };
    });
  });
});

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
      const products = (await listRecordsWithRecovery("product"))
        .map((item) => item.record)
        .filter(
          (product) => product.organizationId === organizationId && product.productId === productId,
        );
      const prior = products.find((product) => !product.sharedProductRef?.detachedAt);
      const reusableTombstone = products.find((product) => !!product.sharedProductRef?.detachedAt);
      if (prior) {
        throw new Error("That product ID is already in use in this organization.");
      }
      const now = new Date().toISOString();
      const product: ProductRecord = {
        kind: "product",
        schemaVersion: 1,
        productRecordId: reusableTombstone?.productRecordId ?? newProductRecordId(),
        organizationId: organizationId as OrganizationId,
        productId,
        ...details,
        visibility: "private",
        createdBySubjectId: actorId,
        createdAt: reusableTombstone?.createdAt ?? now,
        updatedAt: now,
      };
      await persistRecord(product, "product.created", {
        kind: "subject",
        subjectId: manager.subjectId,
      });
      const existingOwnerMembership = await store().readOrganizationMembership(
        organizationId,
        actorId,
        productId,
      );
      const ownerMembership: OrganizationMembershipRecord = {
        kind: "organization-membership",
        schemaVersion: 1,
        organizationMembershipId:
          existingOwnerMembership?.organizationMembershipId ?? newOrganizationMembershipId(),
        organizationId: organizationId as OrganizationId,
        productId,
        subjectId: actorId,
        role: "owner",
        status: "active",
        permissionGrants: [],
        createdAt: existingOwnerMembership?.createdAt ?? now,
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
      if (current.record.sharedProductRef) {
        throw new Error("Shared product details are controlled by the publishing organization.");
      }
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

export interface PublicProductCatalogEntry {
  product: ProductRecord;
  publisherOrganizationName: string;
  status: "available" | "installed" | "setup-required" | "conflict";
}

export interface ProductShareInfo {
  visibility: ProductVisibility;
  adopterOrganizations: Array<{ organizationId: string; name: string }>;
}

function isSharedProductSource(product: ProductRecord): boolean {
  return !product.sharedProductRef && product.visibility === "public";
}

function refersToSharedProduct(installation: ProductRecord, source: ProductRecord): boolean {
  const reference = installation.sharedProductRef;
  return (
    !!reference &&
    reference.sourceOrganizationId === source.organizationId &&
    reference.sourceProductRecordId === source.productRecordId &&
    reference.sourceProductId === source.productId
  );
}

async function withOrganizationMutationLocks<Result>(
  organizationIds: readonly string[],
  operation: () => Promise<Result>,
): Promise<Result> {
  const ordered = [...new Set(organizationIds)].sort();
  const lockAt = (index: number): Promise<Result> =>
    index >= ordered.length
      ? operation()
      : withOrganizationMutationLock(ordered[index], () => lockAt(index + 1));
  return lockAt(0);
}

async function assignSharedProductOwnerUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<void> {
  const previousMembership = await store().readOrganizationMembership(
    organizationId,
    actorId,
    productId,
  );
  const now = new Date().toISOString();
  await persistRecord(
    {
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId:
        previousMembership?.organizationMembershipId ?? newOrganizationMembershipId(),
      organizationId: organizationId as OrganizationId,
      productId: productId as ProductId,
      subjectId: actorId,
      role: "owner",
      status: "active",
      permissionGrants:
        previousMembership?.status === "active" ? (previousMembership.permissionGrants ?? []) : [],
      createdAt: previousMembership?.createdAt ?? now,
      updatedAt: now,
    },
    "product.owner-assigned",
    { kind: "subject", subjectId: actorId },
  );
}

export async function listPublicProductsForOrganization(
  actorId: SubjectId,
  organizationId: string,
): Promise<PublicProductCatalogEntry[]> {
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const [products, organizations, memberships] = await Promise.all([
      listRecordsWithRecovery("product"),
      listRecordsWithRecovery("organization"),
      store().listOrganizationMemberships(organizationId),
    ]);
    const productsWithManager = new Set(
      memberships
        .filter(
          (membership) =>
            !!membership.productId &&
            membership.status === "active" &&
            (membership.role === "owner" || membership.role === "admin"),
        )
        .map((membership) => membership.productId!),
    );
    const organizationById = new Map(
      organizations.map((entry) => [entry.record.organizationId, entry.record]),
    );
    const localProducts = products
      .map((entry) => entry.record)
      .filter((product) => product.organizationId === organizationId);
    const catalog: PublicProductCatalogEntry[] = [];
    for (const source of products
      .map((entry) => entry.record)
      .filter(isSharedProductSource)
      .filter((product) => product.organizationId !== organizationId)) {
      const publisher = organizationById.get(source.organizationId);
      if (!publisher || organizationApprovalStatus(publisher) !== "approved") continue;
      const installed = localProducts.find((product) => product.productId === source.productId);
      let status: PublicProductCatalogEntry["status"] = "available";
      if (installed) {
        if (refersToSharedProduct(installed, source)) {
          status = installed.sharedProductRef?.detachedAt
            ? "available"
            : productsWithManager.has(source.productId)
              ? "installed"
              : "setup-required";
        } else {
          status = "conflict";
        }
      }
      catalog.push({ product: source, publisherOrganizationName: publisher.name, status });
    }
    return catalog.sort((left, right) => left.product.name.localeCompare(right.product.name));
  });
}

export async function installPublicProduct(
  actorId: SubjectId,
  organizationId: string,
  sourceProductRecordId: string,
): Promise<ProductRecord> {
  assertOpaqueId(sourceProductRecordId);
  return authMutationQueue.run(async () => {
    const initialSource = await loadRecord("product", sourceProductRecordId);
    if (!initialSource || !isSharedProductSource(initialSource.record)) {
      throw new Error("This public product is no longer available.");
    }
    const sourceOrganizationId = initialSource.record.organizationId;
    return withOrganizationMutationLocks([organizationId, sourceOrganizationId], async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
      const targetOrganization = await loadApprovedOrganizationUnlocked(organizationId);
      if (!targetOrganization) throw new Error("Organization not found.");
      const sourceRecord = await loadRecord("product", sourceProductRecordId);
      if (!sourceRecord || !isSharedProductSource(sourceRecord.record)) {
        throw new Error("This public product is no longer available.");
      }
      const source = sourceRecord.record;
      if (!(await loadApprovedOrganizationUnlocked(source.organizationId))) {
        throw new Error("This public product is no longer available.");
      }
      const localProducts = (await listRecordsWithRecovery("product"))
        .map((entry) => entry.record)
        .filter((product) => product.organizationId === organizationId);
      const existing = localProducts.find((product) => product.productId === source.productId);

      if (organizationId === source.organizationId) return source;
      if (existing && !refersToSharedProduct(existing, source)) {
        throw new Error(
          "A different product with this ID already exists in this organization. Resolve that conflict before adding the shared product.",
        );
      }
      if (existing && !existing.sharedProductRef?.detachedAt) {
        const installed = await store().readProduct(organizationId, source.productId);
        if (installed) {
          const memberships = await store().listOrganizationMemberships(organizationId);
          const hasProductManager = memberships.some(
            (membership) =>
              membership.productId === source.productId &&
              membership.status === "active" &&
              (membership.role === "owner" || membership.role === "admin"),
          );
          if (!hasProductManager) {
            await assignSharedProductOwnerUnlocked(actorId, organizationId, source.productId);
          }
          return installed;
        }
        throw new Error("This public product installation could not be loaded.");
      }

      const now = new Date().toISOString();
      const installation: ProductRecord = {
        ...source,
        productRecordId: existing?.productRecordId ?? newProductRecordId(),
        organizationId: organizationId as OrganizationId,
        visibility: "public",
        sharedProductRef: {
          sourceOrganizationId: source.organizationId,
          sourceProductRecordId: source.productRecordId,
          sourceProductId: source.productId,
          detachedAt: null,
        },
        createdBySubjectId: actorId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await persistRecord(
        installation,
        existing ? "product.shared-installation-reactivated" : "product.shared-installed",
        { kind: "subject", subjectId: actorId },
      );
      await assignSharedProductOwnerUnlocked(actorId, organizationId, source.productId);
      return installation;
    });
  });
}

async function sharedInstallationsForSourceUnlocked(
  source: ProductRecord,
): Promise<ProductRecord[]> {
  return (await listRecordsWithRecovery("product"))
    .map((entry) => entry.record)
    .filter((product) => product.organizationId !== source.organizationId)
    .filter((product) => refersToSharedProduct(product, source));
}

async function organizationNamesForInstallationsUnlocked(
  installations: readonly ProductRecord[],
): Promise<Array<{ organizationId: string; name: string }>> {
  const organizations = (await listRecordsWithRecovery("organization")).map(
    (entry) => entry.record,
  );
  const byId = new Map(
    organizations.map((organization) => [organization.organizationId, organization]),
  );
  return installations
    .filter((installation) => !installation.sharedProductRef?.detachedAt)
    .map((installation) => {
      const organization = byId.get(installation.organizationId);
      return {
        organizationId: installation.organizationId,
        name: organization?.name ?? "Unknown organization",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getProductShareInfo(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
): Promise<ProductShareInfo> {
  assertOpaqueId(productRecordId);
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const found = await loadRecord("product", productRecordId);
    if (!found || found.record.organizationId !== organizationId || found.record.sharedProductRef) {
      throw new Error("Product not found.");
    }
    const installations = await sharedInstallationsForSourceUnlocked(found.record);
    return {
      visibility: found.record.visibility === "public" ? "public" : "private",
      adopterOrganizations: await organizationNamesForInstallationsUnlocked(installations),
    };
  });
}

async function revokeDetachedProductDataUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const members = await store().listOrganizationMemberships(organizationId);
  for (const membership of members) {
    if (membership.productId !== productId) continue;
    const hasActiveGrant = (membership.permissionGrants ?? []).some(
      (grant) => grant.status === "active",
    );
    if (membership.status === "disabled" && !hasActiveGrant) continue;
    await persistRecord(
      {
        ...membership,
        status: "disabled",
        permissionGrants: (membership.permissionGrants ?? []).map((grant) => ({
          ...grant,
          status: "disabled",
          updatedAt: now,
        })),
        updatedAt: now,
      },
      "product.shared-membership-revoked",
      { kind: "subject", subjectId: actorId },
    );
  }

  const invitations = (await listRecordsWithRecovery("organization-invitation"))
    .map((entry) => entry.record)
    .filter(
      (invitation) =>
        invitation.organizationId === organizationId &&
        invitation.productId === productId &&
        !invitation.revokedAt &&
        !invitation.consumedAt,
    );
  for (const invitation of invitations) {
    await persistRecord({ ...invitation, revokedAt: now }, "product.shared-invitation-revoked", {
      kind: "subject",
      subjectId: actorId,
    });
  }

  const clients = (await listRecordsWithRecovery("consumer-client"))
    .map((entry) => entry.record)
    .filter((client) => client.organizationId === organizationId && client.productId === productId);
  for (const client of clients.filter((item) => item.status === "active")) {
    await persistRecord(
      { ...client, status: "revoked", revokedAt: now, updatedAt: now },
      "product.shared-client-revoked",
      { kind: "subject", subjectId: actorId },
    );
  }

  const clientIds = new Set<string>(clients.map((client) => client.consumerClientId));
  const sessions = (await listRecordsWithRecovery("session"))
    .map((entry) => entry.record)
    .filter(
      (session) =>
        !session.revokedAt &&
        !!session.applicationClientId &&
        clientIds.has(session.applicationClientId),
    );
  for (const session of sessions) {
    await persistRecord({ ...session, revokedAt: now }, "product.shared-session-revoked", {
      kind: "subject",
      subjectId: actorId,
    });
  }

  const principals = (await listRecordsWithRecovery("service-principal"))
    .map((entry) => entry.record)
    .filter(
      (principal) =>
        principal.organizationId === organizationId &&
        principal.productId === productId &&
        principal.status === "active",
    );
  for (const principal of principals) {
    await persistRecord(
      { ...principal, status: "disabled", updatedAt: now },
      "product.shared-service-principal-disabled",
      { kind: "subject", subjectId: actorId },
    );
  }

  const keys = (await listRecordsWithRecovery("api-key"))
    .map((entry) => entry.record)
    .filter(
      (key) =>
        key.scope.organizationId === organizationId &&
        key.scope.productId === productId &&
        key.status === "active",
    );
  for (const key of keys) {
    await persistRecord(
      { ...key, status: "revoked", revokedAt: now },
      "product.shared-key-revoked",
      { kind: "subject", subjectId: actorId },
    );
  }
}

export async function setOrganizationProductVisibility(
  actorId: SubjectId,
  organizationId: string,
  productRecordId: string,
  visibility: ProductVisibility,
  confirmedPrivateRemoval = false,
): Promise<ProductRecord> {
  assertOpaqueId(productRecordId);
  if (visibility !== "public" && visibility !== "private") {
    throw new Error("Choose public or private product visibility.");
  }
  return authMutationQueue.run(async () => {
    const initial = await loadRecord("product", productRecordId);
    if (
      !initial ||
      initial.record.organizationId !== organizationId ||
      initial.record.sharedProductRef
    ) {
      throw new Error("Product not found.");
    }
    const initialInstallations = await sharedInstallationsForSourceUnlocked(initial.record);
    const lockIds = [organizationId, ...initialInstallations.map((entry) => entry.organizationId)];
    return withOrganizationMutationLocks(lockIds, async () => {
      const actor = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("product", productRecordId);
      if (
        !current ||
        current.record.organizationId !== organizationId ||
        current.record.sharedProductRef
      ) {
        throw new Error("Product not found.");
      }
      const installations = await sharedInstallationsForSourceUnlocked(current.record);
      const activeInstallations = installations.filter(
        (installation) => !installation.sharedProductRef?.detachedAt,
      );
      if (visibility === "private" && activeInstallations.length && !confirmedPrivateRemoval) {
        throw new Error(
          "Confirm making this product private to remove it and revoke access in other organizations.",
        );
      }
      const currentVisibility = current.record.visibility === "public" ? "public" : "private";
      if (visibility === currentVisibility && visibility === "public") return current.record;
      if (visibility === "public") {
        const next = { ...current.record, visibility, updatedAt: new Date().toISOString() };
        await persistRecord(next, "product.published", {
          kind: "subject",
          subjectId: actor.subjectId,
        });
        return next;
      }

      for (const installation of installations) {
        await revokeDetachedProductDataUnlocked(
          actor.subjectId,
          installation.organizationId,
          installation.productId,
        );
        if (!installation.sharedProductRef?.detachedAt) {
          await persistRecord(
            {
              ...installation,
              sharedProductRef: {
                ...installation.sharedProductRef!,
                detachedAt: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            },
            "product.shared-installation-removed",
            { kind: "subject", subjectId: actor.subjectId },
          );
        }
      }
      if (currentVisibility === "private") return current.record;
      const next = {
        ...current.record,
        visibility: "private" as const,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "product.unpublished", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return next;
    });
  });
}

export async function createProductAccessRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  input: { name: string; description: string; actions: readonly string[] },
): Promise<ProductAccessRole> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Enter a role name up to 80 characters.");
  }
  if (description.length > 240 || /[\u0000-\u001f\u007f]/.test(description)) {
    throw new Error("The role description must be 240 characters or fewer.");
  }
  const actions = validateActions(input.actions);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const { actor, product } = await requireManageableProductUnlocked(
        actorId,
        organizationId,
        productId,
      );
      const roles = product.accessRoles ?? [];
      if (roles.length >= 32) throw new Error("A product can have up to 32 access roles.");
      if (roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("An access role with that name already exists.");
      }
      const role: ProductAccessRole = {
        id: `role-${randomBytes(16).toString("hex")}`,
        name,
        description,
        actions,
      };
      await persistRecord(
        { ...product, accessRoles: [...roles, role], updatedAt: new Date().toISOString() },
        "product.access-role-created",
        { kind: "subject", subjectId: actor.subjectId },
      );
      return role;
    }),
  );
}

export async function removeProductAccessRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  accessRoleId: string,
): Promise<void> {
  if (!/^role-[0-9a-f]{32}$/.test(accessRoleId)) throw new Error("Choose an access role.");
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const { actor, product } = await requireManageableProductUnlocked(
        actorId,
        organizationId,
        productId,
      );
      const roles = product.accessRoles ?? [];
      const nextRoles = roles.filter((role) => role.id !== accessRoleId);
      if (nextRoles.length === roles.length) throw new Error("Access role not found.");
      await persistRecord(
        { ...product, accessRoles: nextRoles, updatedAt: new Date().toISOString() },
        "product.access-role-removed",
        { kind: "subject", subjectId: actor.subjectId },
      );
    }),
  );
}

async function requireManageableProductUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<{ actor: OrganizationMembershipRecord; product: ProductRecord }> {
  const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
    "owner",
    "admin",
  ]);
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Choose a product in this organization.");
  if (product.sharedProductRef) {
    throw new Error("Shared access roles are controlled by the publishing organization.");
  }
  return { actor, product };
}

export const listProductsForOrganization = cache(async function listProductsForOrganization(
  subjectId: SubjectId,
  organizationId: string,
): Promise<ProductRecord[]> {
  return authMutationQueue.read(async () => {
    const [organization, catalogManager] = await Promise.all([
      loadApprovedOrganizationUnlocked(organizationId),
      organizationMembershipUnlocked(organizationId, subjectId),
    ]);
    if (!organization) throw new Error("Organization not found.");
    const [memberRows, products] = await Promise.all([
      catalogManager ? Promise.resolve([]) : store().listMembershipsForSubject(subjectId),
      store().listProducts(organizationId),
    ]);
    const allowedProducts = new Set(
      memberRows
        .filter(
          (row) =>
            row.organizationId === organizationId && row.productId && row.status === "active",
        )
        .map((row) => row.productId!),
    );
    if (!catalogManager && allowedProducts.size === 0) throw new Error("Organization not found.");
    return products
      .filter((product) => !!catalogManager || allowedProducts.has(product.productId))
      .sort((left, right) => left.name.localeCompare(right.name));
  });
});

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
    catalogRole: catalog?.role ?? null,
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

export interface ConsumerClientSummary {
  clientId: string;
  productId: string;
  appName: string;
  appOrigin: string | null;
  sessionLifetimeMs: number;
  selfRegistrationEnabled: boolean;
  status: ConsumerClientRecord["status"];
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface ConsumerClientCredential {
  clientId: string;
  secret: string;
}

export interface CreateConsumerClientOptions {
  appName: string;
  appOrigin: string;
  sessionLifetimeSeconds: number;
  selfRegistrationEnabled: boolean;
}

function consumerClientSummary(record: ConsumerClientRecord): ConsumerClientSummary {
  return {
    clientId: record.consumerClientId,
    productId: record.productId,
    appName: record.appName,
    appOrigin: record.appOrigin,
    sessionLifetimeMs: record.sessionLifetimeMs,
    selfRegistrationEnabled: record.selfRegistrationEnabled,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

function consumerClientIsManageableInOrganization(
  record: ConsumerClientRecord,
  organizationId: string,
): boolean {
  // Older records did not store their managing organization. A product ID alone cannot prove
  // which organization owns them when product IDs may be reused across organizations.
  return record.organizationId === organizationId;
}

function validateConsumerClientOptions(productId: string, options: CreateConsumerClientOptions) {
  const appName = options.appName.trim().replace(/\s+/g, " ");
  if (!appName || appName.length > 80 || /[\u0000-\u001f\u007f]/.test(appName)) {
    throw new Error("Enter an application name up to 80 characters.");
  }
  let appOrigin: string | null = null;
  if (options.appOrigin.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(options.appOrigin.trim());
    } catch {
      throw new Error("Enter a valid app origin.");
    }
    const isSecure =
      parsed.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" &&
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname));
    if (
      !isSecure ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("Use an HTTPS app origin without a path, query, or fragment.");
    }
    appOrigin = parsed.origin;
  }
  if (
    !Number.isSafeInteger(options.sessionLifetimeSeconds) ||
    options.sessionLifetimeSeconds < 5 * 60 ||
    options.sessionLifetimeSeconds > 90 * 24 * 60 * 60
  ) {
    throw new Error("Session lifetime must be between 5 minutes and 90 days.");
  }
  if (typeof options.selfRegistrationEnabled !== "boolean") {
    throw new Error("Choose whether self-registration is enabled.");
  }
  if (["visitoring", "postparticle"].includes(productId) && options.selfRegistrationEnabled) {
    throw new Error("Public self-registration is disabled for this product.");
  }
  return { appName, appOrigin };
}

export async function getConsumerClientRecord(
  clientId: string,
): Promise<ConsumerClientRecord | null> {
  assertOpaqueId(clientId);
  return authMutationQueue.read(async () => {
    const found = await loadRecord("consumer-client", clientId);
    return found?.record ?? null;
  });
}

export async function hasActiveConsumerClientForProduct(productId: string): Promise<boolean> {
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.read(async () =>
    (await listRecordsWithRecovery("consumer-client")).some(
      (item) => item.record.productId === normalizedProductId && item.record.status === "active",
    ),
  );
}

export async function listConsumerClientsForProduct(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ConsumerClientSummary[]> {
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.read(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, normalizedProductId, [
      "owner",
      "admin",
    ]);
    return (await listRecordsWithRecovery("consumer-client"))
      .map((item) => item.record)
      .filter(
        (record) =>
          record.productId === normalizedProductId &&
          consumerClientIsManageableInOrganization(record, organizationId),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(consumerClientSummary);
  });
}

async function withConsumerClientManager<Result>(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  operation: (actor: OrganizationMembershipRecord, normalizedProductId: string) => Promise<Result>,
): Promise<Result> {
  assertOpaqueId(organizationId);
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, normalizedProductId, [
        "owner",
        "admin",
      ]);
      return operation(actor, normalizedProductId);
    }),
  );
}

export async function createConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  options: CreateConsumerClientOptions,
): Promise<ConsumerClientCredential> {
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const validated = validateConsumerClientOptions(normalizedProductId, options);
      const consumerClientId = newConsumerClientId();
      const secret = `pmc_${consumerClientId}_${randomBytes(32).toString("base64url")}`;
      const now = new Date().toISOString();
      const record: ConsumerClientRecord = {
        kind: "consumer-client",
        schemaVersion: 1,
        consumerClientId,
        organizationId: organizationId as OrganizationId,
        productId: normalizedProductId,
        appName: validated.appName,
        appOrigin: validated.appOrigin,
        sessionLifetimeMs: options.sessionLifetimeSeconds * 1000,
        selfRegistrationEnabled: options.selfRegistrationEnabled,
        verifier: { algorithm: "sha256", digestHex: hashHex(secret) },
        status: "active",
        createdBySubjectId: actor.subjectId,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      };
      await persistRecord(record, "consumer-client.created", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return { clientId: consumerClientId, secret };
    },
  );
}

export async function rotateConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
): Promise<ConsumerClientCredential> {
  assertOpaqueId(clientId);
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const found = await loadRecord("consumer-client", clientId);
      if (
        !found ||
        found.record.productId !== normalizedProductId ||
        found.record.status !== "active" ||
        !consumerClientIsManageableInOrganization(found.record, organizationId)
      ) {
        throw new Error("Choose an active application client for this product.");
      }
      const secret = `pmc_${found.record.consumerClientId}_${randomBytes(32).toString("base64url")}`;
      const next: ConsumerClientRecord = {
        ...found.record,
        verifier: { algorithm: "sha256", digestHex: hashHex(secret) },
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "consumer-client.secret-rotated", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return { clientId: next.consumerClientId, secret };
    },
  );
}

export async function revokeConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
): Promise<void> {
  assertOpaqueId(clientId);
  await withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const found = await loadRecord("consumer-client", clientId);
      if (
        !found ||
        found.record.productId !== normalizedProductId ||
        !consumerClientIsManageableInOrganization(found.record, organizationId)
      ) {
        throw new Error("Application client not found.");
      }
      if (found.record.status === "revoked") return;
      const now = new Date().toISOString();
      await persistRecord(
        {
          ...found.record,
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        },
        "consumer-client.revoked",
        { kind: "subject", subjectId: actor.subjectId },
      );
    },
  );
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

async function productMemberMutationContextUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: SubjectId,
) {
  const owner = await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner"]);
  const current = await store().readOrganizationMembership(organizationId, subjectId, productId);
  return { owner, current };
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
      const { owner, current } = await productMemberMutationContextUnlocked(
        actorId,
        organizationId,
        productId,
        subjectId as SubjectId,
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
      const { owner, current } = await productMemberMutationContextUnlocked(
        actorId,
        organizationId,
        productId,
        subjectId as SubjectId,
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

export interface ConsumerMemberScopeInput {
  organizationId: string;
  productId: string;
  scopeKind: "workspace" | "project";
  resourceId: string;
}

export interface ConsumerScopedMemberView {
  subjectId: SubjectId;
  email: string | null;
  username: string | null;
  emailVerified: boolean;
  active: boolean;
  role: string;
}

function consumerResourceScope(
  authenticatedProductId: string,
  input: ConsumerMemberScopeInput,
): ResourceScope {
  const normalizedProductId = validateProductId(authenticatedProductId);
  if (validateProductId(input.productId) !== normalizedProductId) {
    throw new Error("This application does not manage that product.");
  }
  const policy = consumerProductPolicy(normalizedProductId);
  if (!policy || policy.scopeKind !== input.scopeKind) {
    throw new Error("This application does not manage that resource type.");
  }
  return validateScope(
    input.scopeKind === "workspace"
      ? {
          kind: "workspace",
          organizationId: input.organizationId as OrganizationId,
          productId: normalizedProductId,
          workspaceId: input.resourceId,
        }
      : {
          kind: "project",
          organizationId: input.organizationId as OrganizationId,
          productId: normalizedProductId,
          projectId: input.resourceId,
        },
  );
}

function sameResourceScope(left: ResourceScope, right: ResourceScope): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.productId === right.productId &&
    left.kind === right.kind &&
    scopeResourceId(left) === scopeResourceId(right)
  );
}

function roleGrant(
  authenticatedProductId: string,
  subjectId: SubjectId,
  scope: ResourceScope,
  role: string,
  actions: readonly string[],
  existing?: MembershipRecord,
): MembershipRecord {
  const id = createHash("sha256")
    .update(`${authenticatedProductId}:${scope.kind}:${role}`)
    .digest("hex")
    .slice(0, 32);
  const now = new Date().toISOString();
  return {
    kind: "membership",
    schemaVersion: 1,
    membershipId: existing?.membershipId ?? newMembershipId(),
    subjectId,
    scope,
    grants: [{ scope, actions: [...actions] }],
    accessRole: { id: `role-${id}`, name: role },
    status: "active",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function requireConsumerScopeManagerUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  scope: ResourceScope,
): Promise<OrganizationMembershipRecord> {
  const policy = consumerProductPolicy(authenticatedProductId);
  const actor = await loadSubjectUnlocked(actorId);
  requireVerifiedActiveSubject(actor);
  if (consumerProductState(actor, scope.productId).status !== "active") {
    throw new Error("This account is disabled for the application.");
  }
  if (
    !policy ||
    scope.kind !== policy.scopeKind ||
    !(await loadApprovedOrganizationUnlocked(scope.organizationId))
  ) {
    throw new Error("Resource not found.");
  }
  await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
  const membership = await store().readOrganizationMembership(
    scope.organizationId,
    actorId,
    scope.productId,
  );
  if (
    !membership ||
    membership.status !== "active" ||
    !productMembershipHasPermission(membership, scope, policy.memberManagementAction)
  ) {
    throw new Error("You do not have permission to manage this resource's members.");
  }
  return membership;
}

function hasConsumerPlatformPermission(
  productMembership: OrganizationMembershipRecord,
  action: string,
): boolean {
  const productScope: ResourceScope = {
    kind: "product",
    organizationId: productMembership.organizationId,
    productId: productMembership.productId ?? "",
  };
  return productMembershipHasPermission(productMembership, productScope, action);
}

async function requireConsumerAccountManagerUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  organizationId: string,
  productId: string,
): Promise<OrganizationMembershipRecord> {
  const normalizedProductId = validateProductId(authenticatedProductId);
  if (normalizedProductId !== validateProductId(productId)) {
    throw new Error("This application does not manage that product.");
  }
  const policy = consumerProductPolicy(normalizedProductId);
  if (!policy?.accountManagementAction) {
    throw new Error("This application does not expose global account management.");
  }
  const actor = await loadSubjectUnlocked(actorId);
  requireVerifiedActiveSubject(actor);
  if (consumerProductState(actor, productId).status !== "active") {
    throw new Error("This account is disabled for the application.");
  }
  if (!(await loadApprovedOrganizationUnlocked(organizationId))) {
    throw new Error("Organization not found.");
  }
  await requireOrganizationProductUnlocked(organizationId, productId);
  const membership = await store().readOrganizationMembership(organizationId, actorId, productId);
  if (
    !membership ||
    membership.status !== "active" ||
    !hasConsumerPlatformPermission(membership, policy.accountManagementAction)
  ) {
    throw new Error("Platform administrator access is required.");
  }
  return membership;
}

function consumerMemberGrant(
  membership: OrganizationMembershipRecord,
  scope: ResourceScope,
): MembershipRecord | null {
  return (
    membership.permissionGrants?.find((grant) => sameResourceScope(grant.scope, scope)) ?? null
  );
}

function usernameForProduct(subject: SubjectRecord, productId: string): string | null {
  return (
    subject.loginIdentifiers?.find(
      (identifier) => identifier.kind === "username" && identifier.productId === productId,
    )?.value ?? null
  );
}

export async function listConsumerMembers(
  actorId: SubjectId,
  authenticatedProductId: string,
  input: ConsumerMemberScopeInput,
): Promise<ConsumerScopedMemberView[]> {
  const scope = consumerResourceScope(authenticatedProductId, input);
  return authMutationQueue.run(async () => {
    await requireConsumerScopeManagerUnlocked(actorId, authenticatedProductId, scope);
    const rows = (await store().listOrganizationMemberships(scope.organizationId)).filter(
      (membership) =>
        membership.productId === scope.productId &&
        membership.permissionGrants?.some((grant) => sameResourceScope(grant.scope, scope)),
    );
    const members: ConsumerScopedMemberView[] = [];
    for (const membership of rows) {
      const grant = consumerMemberGrant(membership, scope);
      if (!grant) continue;
      const subject = await loadSubjectUnlocked(membership.subjectId);
      if (!subject) continue;
      members.push({
        subjectId: subject.subjectId,
        email: subject.primaryEmail,
        username: usernameForProduct(subject, scope.productId),
        emailVerified: !!subject.emailVerifiedAt,
        active:
          subject.status === "active" &&
          consumerProductState(subject, scope.productId).status === "active" &&
          membership.status === "active" &&
          grant.status === "active",
        role: grant.accessRole?.name ?? "",
      });
    }
    return members.sort((left, right) =>
      (left.email ?? left.username ?? "").localeCompare(right.email ?? right.username ?? ""),
    );
  });
}

async function findConsumerSubjectUnlocked(
  productId: string,
  emailInput?: string,
  usernameInput?: string,
): Promise<{ subject: SubjectRecord | null; email: string | null; username: string | null }> {
  const email = emailInput === undefined ? null : canonicalEmail(emailInput);
  const username = usernameInput === undefined ? null : normalizeProductUsername(usernameInput);
  const byEmail = email ? await loadSubjectByEmailUnlocked(email) : null;
  const byUsername = username ? await loadSubjectByUsernameUnlocked(productId, username) : null;
  if (byEmail && byUsername && byEmail.subjectId !== byUsername.subjectId) {
    throw new Error("The email and username belong to different accounts.");
  }
  return { subject: byEmail ?? byUsername, email, username };
}

async function ensureConsumerUsernameUnlocked(
  subject: SubjectRecord,
  productId: string,
  username: string,
): Promise<SubjectRecord> {
  const currentUsernameId = await store().findSubjectIdByUsername(productId, username);
  if (currentUsernameId && currentUsernameId !== subject.subjectId) {
    throw new Error("That username is already in use.");
  }
  const current = subject.loginIdentifiers ?? [];
  if (
    current.some(
      (identifier) =>
        identifier.kind === "username" &&
        identifier.productId === productId &&
        identifier.normalizedValue === username,
    )
  ) {
    return subject;
  }
  const next: SubjectRecord = {
    ...subject,
    loginIdentifiers: [
      ...current,
      { kind: "username", productId, value: username, normalizedValue: username },
    ],
    updatedAt: new Date().toISOString(),
  };
  await persistRecord(next, "identity.login-identifier-added", {
    kind: "subject",
    subjectId: subject.subjectId,
  });
  return next;
}

async function ensureConsumerProductMembershipUnlocked(
  subject: SubjectRecord,
  organizationId: string,
  productId: string,
): Promise<OrganizationMembershipRecord> {
  const existing = await store().readOrganizationMembership(
    organizationId,
    subject.subjectId,
    productId,
  );
  if (existing) {
    if (existing.status === "active") return existing;
    const next = { ...existing, status: "active" as const, updatedAt: new Date().toISOString() };
    await persistRecord(next, "product.member-reactivated", {
      kind: "subject",
      subjectId: subject.subjectId,
    });
    return next;
  }
  const now = new Date().toISOString();
  const membership: OrganizationMembershipRecord = {
    kind: "organization-membership",
    schemaVersion: 1,
    organizationMembershipId: newOrganizationMembershipId(),
    organizationId: organizationId as OrganizationId,
    productId,
    subjectId: subject.subjectId,
    role: "member",
    status: "active",
    permissionGrants: [],
    createdAt: now,
    updatedAt: now,
  };
  await persistRecord(membership, "product.member-added", {
    kind: "subject",
    subjectId: subject.subjectId,
  });
  return membership;
}

async function setConsumerMemberRoleUnlocked(
  authenticatedProductId: string,
  subjectId: SubjectId,
  scope: ResourceScope,
  role: string,
  existing?: MembershipRecord,
): Promise<MembershipRecord> {
  const actions = consumerRoleActions(authenticatedProductId, role);
  if (!actions) throw new Error("Choose a role supported by this application.");
  const membership = await store().readOrganizationMembership(
    scope.organizationId,
    subjectId,
    scope.productId,
  );
  if (!membership || membership.status !== "active") {
    throw new Error("The account is not an active member of this product.");
  }
  const grant = roleGrant(authenticatedProductId, subjectId, scope, role, actions, existing);
  await persistRecord(grant, "consumer.member-role-updated", {
    kind: "subject",
    subjectId: membership.subjectId,
  });
  return grant;
}

async function isConsumerPlatformAdminUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  organizationId: string,
  productId: string,
): Promise<boolean> {
  const policy = consumerProductPolicy(authenticatedProductId);
  if (!policy?.accountManagementAction) return false;
  const membership = await store().readOrganizationMembership(organizationId, actorId, productId);
  return (
    !!membership &&
    membership.status === "active" &&
    hasConsumerPlatformPermission(membership, policy.accountManagementAction)
  );
}

async function setConsumerPlatformAdminUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  subject: SubjectRecord,
  organizationId: string,
  productId: string,
  enabled: boolean,
): Promise<void> {
  const policy = consumerProductPolicy(authenticatedProductId);
  if (!policy?.accountManagementAction || !policy.platformAdminActions) {
    throw new Error("This application does not expose platform administrator management.");
  }
  const productMembership = await ensureConsumerProductMembershipUnlocked(
    subject,
    organizationId,
    productId,
  );
  const productScope: ResourceScope = {
    kind: "product",
    organizationId: organizationId as OrganizationId,
    productId,
  };
  const currentGrant = consumerMemberGrant(productMembership, productScope);
  if (enabled) {
    const nextGrant = roleGrant(
      authenticatedProductId,
      subject.subjectId,
      productScope,
      "platform-admin",
      policy.platformAdminActions,
      currentGrant ?? undefined,
    );
    await persistRecord(nextGrant, "consumer.platform-admin-enabled", {
      kind: "subject",
      subjectId: actorId,
    });
  } else if (currentGrant?.accessRole?.name === "platform-admin") {
    await persistRecord(
      { ...currentGrant, status: "disabled", updatedAt: new Date().toISOString() },
      "consumer.platform-admin-disabled",
      { kind: "subject", subjectId: actorId },
    );
  }
}

async function isConsumerIdentitySharedAcrossProductsUnlocked(
  subject: SubjectRecord,
  authenticatedProductId: string,
  productId: string,
): Promise<boolean> {
  const normalizedProductId = authenticatedProductId.toLowerCase();
  if (
    subject.loginIdentifiers?.some((identifier) => identifier.productId !== productId) ||
    subject.consumerProductStates?.some((state) => state.productId !== productId) ||
    subject.legacySources?.some((source) => source.source !== normalizedProductId)
  ) {
    return true;
  }
  const productMemberships = await store().listMembershipsForSubject(subject.subjectId);
  return productMemberships.some(
    (membership) => !!membership.productId && membership.productId !== productId,
  );
}

async function protectLastVisitoringAdminUnlocked(
  authenticatedProductId: string,
  targetId: SubjectId,
  scope: ResourceScope,
  currentGrant: MembershipRecord,
  nextRole: string | null,
  nextStatus: "active" | "disabled",
): Promise<void> {
  if (
    authenticatedProductId.toLowerCase() !== "visitoring" ||
    currentGrant.status !== "active" ||
    currentGrant.accessRole?.name !== "admin" ||
    (nextRole === "admin" && nextStatus === "active")
  ) {
    return;
  }
  const memberships = await store().listOrganizationMemberships(scope.organizationId);
  for (const membership of memberships) {
    const hasActiveAdminGrant =
      membership.productId === scope.productId &&
      membership.status === "active" &&
      membership.permissionGrants?.some(
        (grant) =>
          sameResourceScope(grant.scope, scope) &&
          grant.status === "active" &&
          grant.accessRole?.name === "admin" &&
          grant.subjectId !== targetId,
      );
    if (hasActiveAdminGrant) {
      const subject = await loadSubjectUnlocked(membership.subjectId);
      if (subject?.status === "active") return;
    }
  }
  throw new Error("The workspace must keep an active administrator.");
}

export async function createConsumerMember(
  actorId: SubjectId,
  authenticatedProductId: string,
  input: ConsumerMemberScopeInput & {
    email?: string;
    username?: string;
    password?: string;
    role: string;
  },
): Promise<{ member: ConsumerScopedMemberView; created: boolean }> {
  const scope = consumerResourceScope(authenticatedProductId, input);
  if (!consumerRoleActions(authenticatedProductId, input.role)) {
    throw new Error("Choose a role supported by this application.");
  }
  const email = input.email === undefined ? null : canonicalEmail(input.email);
  const username = input.username === undefined ? null : normalizeProductUsername(input.username);
  if (!email && !username) throw new Error("Provide an email address or username.");
  if (input.password !== undefined) validatePassword(input.password);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actorMembership = await requireConsumerScopeManagerUnlocked(
        actorId,
        authenticatedProductId,
        scope,
      );
      let subject = (
        await findConsumerSubjectUnlocked(input.productId, input.email, input.username)
      ).subject;
      const created = !subject;
      const platformAdmin = await isConsumerPlatformAdminUnlocked(
        actorId,
        authenticatedProductId,
        scope.organizationId,
        scope.productId,
      );
      if (!subject) {
        if (!input.password) throw new Error("Provide an initial password for the new account.");
        if (authenticatedProductId.toLowerCase() === "postparticle" && !platformAdmin) {
          throw new Error("A platform administrator must create this account first.");
        }
        subject = await createAdminProvisionedSubject(
          email,
          input.password,
          actorMembership.subjectId,
        );
      }
      if (
        subject.status !== "active" ||
        consumerProductState(subject, scope.productId).status !== "active"
      ) {
        throw new Error("The account is disabled.");
      }
      if (username) {
        const alreadyLinked = usernameForProduct(subject, input.productId) === username;
        if (
          !alreadyLinked &&
          !platformAdmin &&
          authenticatedProductId.toLowerCase() === "postparticle"
        ) {
          throw new Error("A platform administrator must assign a new PostParticle username.");
        }
        subject = await ensureConsumerUsernameUnlocked(subject, input.productId, username);
      }
      await ensureConsumerProductMembershipUnlocked(subject, scope.organizationId, scope.productId);
      const productMembership = await store().readOrganizationMembership(
        scope.organizationId,
        subject.subjectId,
        scope.productId,
      );
      const priorGrant = productMembership ? consumerMemberGrant(productMembership, scope) : null;
      const grant = await setConsumerMemberRoleUnlocked(
        authenticatedProductId,
        subject.subjectId,
        scope,
        input.role,
        priorGrant ?? undefined,
      );
      return {
        created,
        member: {
          subjectId: subject.subjectId,
          email: subject.primaryEmail,
          username: usernameForProduct(subject, scope.productId),
          emailVerified: !!subject.emailVerifiedAt,
          active: subject.status === "active" && grant.status === "active",
          role: grant.accessRole?.name ?? input.role,
        },
      };
    }),
  );
}

export async function updateConsumerMember(
  actorId: SubjectId,
  authenticatedProductId: string,
  subjectIdInput: string,
  input: ConsumerMemberScopeInput & {
    role?: string;
    status?: "active" | "disabled";
    password?: string;
  },
): Promise<void> {
  assertOpaqueId(subjectIdInput);
  const subjectId = subjectIdInput as SubjectId;
  const scope = consumerResourceScope(authenticatedProductId, input);
  if (input.role !== undefined && !consumerRoleActions(authenticatedProductId, input.role)) {
    throw new Error("Choose a role supported by this application.");
  }
  if (input.status === undefined && input.role === undefined && input.password === undefined) {
    throw new Error("Provide a role, status, or password change.");
  }
  if (input.password !== undefined) validatePassword(input.password);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      await requireConsumerScopeManagerUnlocked(actorId, authenticatedProductId, scope);
      const platformAdmin = await isConsumerPlatformAdminUnlocked(
        actorId,
        authenticatedProductId,
        scope.organizationId,
        scope.productId,
      );
      if (
        actorId === subjectId &&
        (authenticatedProductId.toLowerCase() === "visitoring" || !platformAdmin)
      ) {
        throw new Error("Ask another administrator to change your account.");
      }
      const productMembership = await store().readOrganizationMembership(
        scope.organizationId,
        subjectId,
        scope.productId,
      );
      const currentGrant = productMembership ? consumerMemberGrant(productMembership, scope) : null;
      if (!productMembership || !currentGrant) throw new Error("Member not found.");
      const subject = input.password === undefined ? null : await loadSubjectUnlocked(subjectId);
      if (input.password !== undefined && (!subject || subject.status !== "active")) {
        throw new Error("Member not found.");
      }
      if (
        subject &&
        (await isConsumerIdentitySharedAcrossProductsUnlocked(
          subject,
          authenticatedProductId,
          scope.productId,
        ))
      ) {
        throw new Error(
          "An administrator cannot reset shared credentials across products; the account owner must.",
        );
      }
      const nextRole = input.role ?? currentGrant.accessRole?.name ?? null;
      const nextStatus = input.status ?? currentGrant.status;
      await protectLastVisitoringAdminUnlocked(
        authenticatedProductId,
        subjectId,
        scope,
        currentGrant,
        nextRole,
        nextStatus,
      );
      let nextGrant = currentGrant;
      if (input.status === "active" && productMembership.status !== "active") {
        await persistRecord(
          { ...productMembership, status: "active", updatedAt: new Date().toISOString() },
          "product.member-reactivated",
          { kind: "subject", subjectId: actorId },
        );
      }
      if (input.role !== undefined) {
        nextGrant = await setConsumerMemberRoleUnlocked(
          authenticatedProductId,
          subjectId,
          scope,
          input.role,
          currentGrant,
        );
      }
      if (input.status !== undefined && input.status !== nextGrant.status) {
        await persistRecord(
          { ...nextGrant, status: input.status, updatedAt: new Date().toISOString() },
          input.status === "disabled" ? "consumer.member-disabled" : "consumer.member-enabled",
          { kind: "subject", subjectId: actorId },
        );
      }
      if (input.password !== undefined) {
        await persistRecord(
          {
            ...subject!,
            passwordCredential: await createPasswordCredential(input.password),
            authVersion: subject!.authVersion + 1,
            updatedAt: new Date().toISOString(),
          },
          "credential.admin-reset",
          { kind: "subject", subjectId: actorId },
        );
      }
      const updatedMembership = await store().readOrganizationMembership(
        scope.organizationId,
        subjectId,
        scope.productId,
      );
      if (updatedMembership && updatedMembership.role !== "owner") {
        const hasActiveGrant = (updatedMembership.permissionGrants ?? []).some(
          (grant) => grant.status === "active",
        );
        const nextMembershipStatus = hasActiveGrant ? "active" : "disabled";
        if (updatedMembership.status !== nextMembershipStatus) {
          await persistRecord(
            {
              ...updatedMembership,
              status: nextMembershipStatus,
              updatedAt: new Date().toISOString(),
            },
            nextMembershipStatus === "active"
              ? "product.member-reactivated"
              : "product.member-removed",
            { kind: "subject", subjectId: actorId },
          );
        }
      }
    }),
  );
}

export async function removeConsumerMember(
  actorId: SubjectId,
  authenticatedProductId: string,
  subjectId: string,
  input: ConsumerMemberScopeInput,
): Promise<void> {
  return updateConsumerMember(actorId, authenticatedProductId, subjectId, {
    ...input,
    status: "disabled",
  });
}

export interface ConsumerAccountView {
  subjectId: SubjectId;
  email: string | null;
  username: string;
  status: "active" | "disabled";
  platformAdmin: boolean;
}

export async function listConsumerAccounts(
  actorId: SubjectId,
  authenticatedProductId: string,
  organizationId: string,
  productId: string,
): Promise<ConsumerAccountView[]> {
  if (validateProductId(authenticatedProductId) !== validateProductId(productId)) {
    throw new Error("This application does not manage that product.");
  }
  return authMutationQueue.run(async () => {
    await requireConsumerAccountManagerUnlocked(
      actorId,
      authenticatedProductId,
      organizationId,
      productId,
    );
    const policy = consumerProductPolicy(authenticatedProductId)!;
    const subjects = (await listRecordsWithRecovery("subject")).map((item) => item.record);
    const result: ConsumerAccountView[] = [];
    for (const subject of subjects) {
      const username = usernameForProduct(subject, productId);
      if (!username) continue;
      const membership = await store().readOrganizationMembership(
        organizationId,
        subject.subjectId,
        productId,
      );
      result.push({
        subjectId: subject.subjectId,
        email: subject.primaryEmail,
        username,
        status: consumerProductState(subject, productId).status,
        platformAdmin:
          !!membership &&
          hasConsumerPlatformPermission(membership, policy.accountManagementAction ?? ""),
      });
    }
    return result.sort((left, right) => left.username.localeCompare(right.username));
  });
}

export async function createConsumerAccount(
  actorId: SubjectId,
  authenticatedProductId: string,
  input: {
    organizationId: string;
    productId: string;
    username: string;
    email?: string;
    password: string;
    platformAdmin?: boolean;
  },
): Promise<{ account: ConsumerAccountView; created: boolean }> {
  if (validateProductId(authenticatedProductId) !== validateProductId(input.productId)) {
    throw new Error("This application does not manage that product.");
  }
  const policy = consumerProductPolicy(validateProductId(authenticatedProductId));
  if (authenticatedProductId.toLowerCase() !== "postparticle" || !policy?.accountManagementAction) {
    throw new Error("This application does not expose global account provisioning.");
  }
  const accountManagementAction = policy.accountManagementAction;
  const username = normalizeProductUsername(input.username);
  const email = input.email === undefined ? null : canonicalEmail(input.email);
  validatePassword(input.password);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(input.organizationId, async () => {
      await requireConsumerAccountManagerUnlocked(
        actorId,
        authenticatedProductId,
        input.organizationId,
        input.productId,
      );
      const byUsername = await loadSubjectByUsernameUnlocked(input.productId, username);
      const byEmail = email ? await loadSubjectByEmailUnlocked(email) : null;
      if (byUsername && byEmail && byUsername.subjectId !== byEmail.subjectId) {
        throw new Error("The email and username belong to different accounts.");
      }
      let subject = byEmail ?? byUsername;
      const created = !subject;
      if (!subject) {
        subject = await createAdminProvisionedSubject(email, input.password, actorId);
      }
      if (
        subject.status !== "active" ||
        consumerProductState(subject, input.productId).status !== "active"
      ) {
        throw new Error("The account is disabled.");
      }
      subject = await ensureConsumerUsernameUnlocked(subject, input.productId, username);
      await ensureConsumerProductMembershipUnlocked(subject, input.organizationId, input.productId);
      if (input.platformAdmin === true) {
        await setConsumerPlatformAdminUnlocked(
          actorId,
          authenticatedProductId,
          subject,
          input.organizationId,
          input.productId,
          true,
        );
      }
      const updatedMembership = await store().readOrganizationMembership(
        input.organizationId,
        subject.subjectId,
        input.productId,
      );
      const hasPlatformRole =
        !!updatedMembership &&
        hasConsumerPlatformPermission(updatedMembership, accountManagementAction);
      return {
        created,
        account: {
          subjectId: subject.subjectId,
          email: subject.primaryEmail,
          username,
          status: consumerProductState(subject, input.productId).status,
          platformAdmin: hasPlatformRole,
        },
      };
    }),
  );
}

export async function updateConsumerAccount(
  actorId: SubjectId,
  authenticatedProductId: string,
  subjectIdInput: string,
  input: {
    organizationId: string;
    productId: string;
    status?: "active" | "disabled";
    password?: string;
    revokeSessions?: boolean;
    platformAdmin?: boolean;
  },
): Promise<void> {
  assertOpaqueId(subjectIdInput);
  if (validateProductId(authenticatedProductId) !== validateProductId(input.productId)) {
    throw new Error("This application does not manage that product.");
  }
  if (actorId === subjectIdInput) throw new Error("You cannot change your own account here.");
  if (
    input.status === undefined &&
    input.password === undefined &&
    !input.revokeSessions &&
    input.platformAdmin === undefined
  ) {
    throw new Error("Provide a status, password, platform role, or session revocation change.");
  }
  if (input.password !== undefined) validatePassword(input.password);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(input.organizationId, async () => {
      await requireConsumerAccountManagerUnlocked(
        actorId,
        authenticatedProductId,
        input.organizationId,
        input.productId,
      );
      const current = await loadSubjectUnlocked(subjectIdInput);
      if (!current || !usernameForProduct(current, input.productId)) {
        throw new Error("Account not found.");
      }
      const currentProductState = consumerProductState(current, input.productId);
      if (
        input.password !== undefined &&
        (await isConsumerIdentitySharedAcrossProductsUnlocked(
          current,
          authenticatedProductId,
          input.productId,
        ))
      ) {
        throw new Error(
          "An administrator cannot reset shared credentials across products; the account owner must.",
        );
      }
      if (input.platformAdmin !== undefined) {
        await setConsumerPlatformAdminUnlocked(
          actorId,
          authenticatedProductId,
          current,
          input.organizationId,
          input.productId,
          input.platformAdmin,
        );
      }
      const nextStatus = input.status ?? currentProductState.status;
      const statusChanged = nextStatus !== currentProductState.status;
      const nextCredential = input.password
        ? await createPasswordCredential(input.password)
        : current.passwordCredential;
      if (!statusChanged && !input.password && !input.revokeSessions) {
        return;
      }
      const consumerProductStates =
        statusChanged || input.revokeSessions
          ? updateConsumerProductState(current, input.productId, nextStatus, input.revokeSessions)
          : current.consumerProductStates;
      await persistRecord(
        {
          ...current,
          consumerProductStates,
          passwordCredential: nextCredential,
          authVersion: current.authVersion + (input.password ? 1 : 0),
          updatedAt: new Date().toISOString(),
        },
        input.password
          ? "credential.admin-reset"
          : input.revokeSessions
            ? "session.account-revoked"
            : nextStatus === "disabled"
              ? "consumer.account-disabled"
              : "consumer.account-enabled",
        { kind: "subject", subjectId: actorId },
      );
    }),
  );
}

export interface LegacyAuthImportInput {
  visitoring?: {
    organizationId: string;
    users: Array<{ id: string; email: string; passwordHash: string }>;
    memberships: Array<{
      userId: string;
      workspaceId: string;
      role: "admin" | "viewer";
      active?: boolean;
    }>;
  };
  postparticle?: {
    organizationId: string;
    users: Array<{
      username: string;
      email?: string;
      passwordHash: string;
      platformAdmin?: boolean;
      disabled?: boolean;
    }>;
    memberships: Array<{
      username: string;
      projectId: string;
      role: "admin" | "editor" | "viewer" | null;
    }>;
  };
  /** Map a normalized identity key to the legacy source reference whose password to retain. */
  credentialSelections?: Record<string, string>;
}

export interface LegacyAuthImportReport {
  dryRun: boolean;
  applied: boolean;
  identities: number;
  memberships: number;
  conflicts: Array<{ identity: string; candidates: string[] }>;
  errors: string[];
}

interface LegacyIdentityCandidate {
  source: "visitoring" | "postparticle";
  accountId: string;
  sourceRef: string;
  email: string | null;
  username: string | null;
  credential: PasswordCredential;
  disabled: boolean;
  platformAdmin: boolean;
}

function importedCredential(
  source: LegacyIdentityCandidate["source"],
  encodedVerifier: string,
): PasswordCredential {
  if (source === "visitoring") {
    if (!/^\$argon2id\$v=\d+\$/.test(encodedVerifier)) {
      throw new Error("Visitoring password hashes must use the Argon2id PHC format.");
    }
    return {
      algorithm: "argon2id",
      format: "argon2id-phc",
      encodedVerifier,
      updatedAt: new Date().toISOString(),
    };
  }
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(encodedVerifier)) {
    throw new Error("PostParticle password hashes must use the legacy salt:hex format.");
  }
  return {
    algorithm: "scrypt",
    format: "postparticle-scrypt-v1",
    encodedVerifier,
    updatedAt: new Date().toISOString(),
  };
}

async function upsertImportedRoleGrantUnlocked(
  clientId: string,
  subject: SubjectRecord,
  scope: ResourceScope,
  role: string,
  actions: readonly string[],
  status: "active" | "disabled" = "active",
): Promise<void> {
  await ensureConsumerProductMembershipUnlocked(subject, scope.organizationId, scope.productId);
  const subjectId = subject.subjectId;
  const membership = await store().readOrganizationMembership(
    scope.organizationId,
    subjectId,
    scope.productId,
  );
  if (!membership) throw new Error("Could not create the product membership for import.");
  const existing = consumerMemberGrant(membership, scope) ?? undefined;
  const nextGrant = {
    ...roleGrant(clientId, subjectId, scope, role, actions, existing),
    status,
    updatedAt: new Date().toISOString(),
  };
  if (
    existing &&
    existing.status === nextGrant.status &&
    existing.accessRole?.name === nextGrant.accessRole?.name &&
    JSON.stringify(existing.grants) === JSON.stringify(nextGrant.grants)
  ) {
    return;
  }
  await persistRecord(nextGrant, "legacy-import.membership", { kind: "system" });
}

function legacyIdentityKey(email: string | null, username: string | null): string {
  return email ? `email:${email}` : `postparticle:${username ?? ""}`;
}

function legacySourceRef(source: "visitoring" | "postparticle", accountId: string): string {
  return `${source}:${accountId}`;
}

export async function importLegacyAuthData(
  input: LegacyAuthImportInput,
  products: { visitoringProductId?: string; postparticleProductId?: string },
  dryRun: boolean,
): Promise<LegacyAuthImportReport> {
  return authMutationQueue.run(async () => {
    const visitoring = input.visitoring
      ? { ...input.visitoring, organizationId: input.visitoring.organizationId.toLowerCase() }
      : undefined;
    const postparticle = input.postparticle
      ? { ...input.postparticle, organizationId: input.postparticle.organizationId.toLowerCase() }
      : undefined;
    const report: LegacyAuthImportReport = {
      dryRun,
      applied: false,
      identities: 0,
      memberships: 0,
      conflicts: [],
      errors: [],
    };
    const groups = new Map<string, LegacyIdentityCandidate[]>();
    const visitoringRefToKey = new Map<string, string>();
    const postparticleRefToKey = new Map<string, string>();
    const seenSourceRefs = new Set<string>();
    const addCandidate = (candidate: LegacyIdentityCandidate) => {
      const key = legacyIdentityKey(candidate.email, candidate.username);
      const group = groups.get(key) ?? [];
      if (seenSourceRefs.has(candidate.sourceRef)) {
        report.errors.push(`Duplicate legacy account reference: ${candidate.sourceRef}`);
        return;
      }
      seenSourceRefs.add(candidate.sourceRef);
      group.push(candidate);
      groups.set(key, group);
      if (candidate.source === "visitoring") visitoringRefToKey.set(candidate.accountId, key);
      else postparticleRefToKey.set(candidate.accountId, key);
    };

    if (visitoring) {
      if (!products.visitoringProductId) report.errors.push("Visitoring client is not configured.");
      if (!(await loadApprovedOrganizationUnlocked(visitoring.organizationId))) {
        report.errors.push("Visitoring organization was not found or is not approved.");
      } else if (
        products.visitoringProductId &&
        !(await store().readProduct(visitoring.organizationId, products.visitoringProductId))
      ) {
        report.errors.push("Visitoring product was not found in the configured organization.");
      }
      for (const account of visitoring.users) {
        try {
          const accountId = account.id.trim();
          if (!accountId || accountId.length > 254)
            throw new Error("Invalid Visitoring account ID.");
          const email = canonicalEmail(account.email);
          addCandidate({
            source: "visitoring",
            accountId,
            sourceRef: legacySourceRef("visitoring", accountId),
            email,
            username: null,
            credential: importedCredential("visitoring", account.passwordHash),
            disabled: false,
            platformAdmin: false,
          });
        } catch (error) {
          report.errors.push(
            error instanceof Error ? error.message : "Invalid Visitoring account.",
          );
        }
      }
      for (const membership of visitoring.memberships) {
        if (!visitoringRefToKey.has(membership.userId)) {
          report.errors.push(
            `Visitoring membership refers to an unknown account: ${membership.userId}`,
          );
        }
        try {
          if (products.visitoringProductId) {
            consumerResourceScope("visitoring", {
              organizationId: visitoring.organizationId,
              productId: products.visitoringProductId,
              scopeKind: "workspace",
              resourceId: membership.workspaceId,
            });
          }
        } catch {
          report.errors.push(`Invalid Visitoring workspace ID: ${membership.workspaceId}`);
        }
      }
    }

    if (postparticle) {
      if (!products.postparticleProductId)
        report.errors.push("PostParticle client is not configured.");
      if (!(await loadApprovedOrganizationUnlocked(postparticle.organizationId))) {
        report.errors.push("PostParticle organization was not found or is not approved.");
      } else if (
        products.postparticleProductId &&
        !(await store().readProduct(postparticle.organizationId, products.postparticleProductId))
      ) {
        report.errors.push("PostParticle product was not found in the configured organization.");
      }
      for (const account of postparticle.users) {
        try {
          const username = normalizeProductUsername(account.username);
          const email = account.email
            ? canonicalEmail(account.email)
            : username.includes("@")
              ? canonicalEmail(username)
              : null;
          addCandidate({
            source: "postparticle",
            accountId: username,
            sourceRef: legacySourceRef("postparticle", username),
            email,
            username,
            credential: importedCredential("postparticle", account.passwordHash),
            disabled: !!account.disabled,
            platformAdmin: !!account.platformAdmin,
          });
        } catch (error) {
          report.errors.push(
            error instanceof Error ? error.message : "Invalid PostParticle account.",
          );
        }
      }
      for (const membership of postparticle.memberships) {
        try {
          const username = normalizeProductUsername(membership.username);
          if (!postparticleRefToKey.has(username)) {
            report.errors.push(`PostParticle membership refers to an unknown account: ${username}`);
          }
          if (membership.role !== null && !consumerRoleActions("postparticle", membership.role)) {
            report.errors.push(`Invalid PostParticle role for ${username}.`);
          }
          if (products.postparticleProductId && membership.role !== null) {
            consumerResourceScope("postparticle", {
              organizationId: postparticle.organizationId,
              productId: products.postparticleProductId,
              scopeKind: "project",
              resourceId: membership.projectId,
            });
          }
        } catch {
          report.errors.push(`Invalid PostParticle membership for ${membership.username}.`);
        }
      }
    }

    const prepared = new Map<
      string,
      {
        subject: SubjectRecord | null;
        candidates: LegacyIdentityCandidate[];
        credential: PasswordCredential;
        credentialSource: string;
        key: string;
      }
    >();
    for (const [key, candidates] of groups) {
      const email = candidates.find((candidate) => candidate.email)?.email ?? null;
      let subject = email ? await loadSubjectByEmailUnlocked(email) : null;
      for (const candidate of candidates.filter(
        (item) => item.username && products.postparticleProductId,
      )) {
        const byUsername = await loadSubjectByUsernameUnlocked(
          products.postparticleProductId!,
          candidate.username!,
        );
        if (subject && byUsername && subject.subjectId !== byUsername.subjectId) {
          report.errors.push(`Identity mapping conflict for ${key}.`);
        } else if (byUsername) {
          subject = byUsername;
        }
      }
      if (subject?.primaryEmail && email && subject.primaryEmail.toLowerCase() !== email) {
        report.errors.push(`Email conflict for ${key}.`);
      }
      const candidateRefs = candidates.map((candidate) => candidate.sourceRef);
      const allSourcesAlreadyImported =
        !!subject &&
        candidateRefs.every((sourceRef) =>
          subject!.legacySources?.some(
            (source) => legacySourceRef(source.source, source.accountId) === sourceRef,
          ),
        );
      const credentialOptions: Array<{ sourceRef: string; credential: PasswordCredential }> =
        candidates.map((candidate) => ({
          sourceRef: candidate.sourceRef,
          credential: candidate.credential,
        }));
      if (subject?.passwordCredential && !allSourcesAlreadyImported) {
        credentialOptions.push({
          sourceRef: `perminister:${subject.subjectId}`,
          credential: subject.passwordCredential,
        });
      }
      const distinct = new Map(
        credentialOptions.map((option) => [
          `${option.credential.algorithm}:${option.credential.encodedVerifier}`,
          option,
        ]),
      );
      let selected: { sourceRef: string; credential: PasswordCredential } | undefined =
        allSourcesAlreadyImported && subject?.passwordCredential
          ? {
              sourceRef: subject.legacyCredentialSource ?? candidateRefs[0],
              credential: subject.passwordCredential,
            }
          : [...distinct.values()][0];
      if (!allSourcesAlreadyImported && distinct.size > 1) {
        const selection = input.credentialSelections?.[key];
        selected = selection
          ? credentialOptions.find((option) => option.sourceRef === selection)
          : undefined;
        if (!selected) {
          report.conflicts.push({
            identity: key,
            candidates: credentialOptions.map((option) => option.sourceRef),
          });
          continue;
        }
      }
      if (!selected) {
        report.errors.push(`No usable password credential was found for ${key}.`);
        continue;
      }
      prepared.set(key, {
        key,
        subject,
        candidates,
        credential: selected.credential,
        credentialSource: selected.sourceRef,
      });
    }

    report.identities = groups.size;
    report.memberships =
      (input.visitoring?.memberships.length ?? 0) +
      (input.postparticle?.memberships.filter((membership) => membership.role !== null).length ??
        0);
    if (dryRun || report.errors.length > 0 || report.conflicts.length > 0) return report;

    const subjectByKey = new Map<string, SubjectRecord>();
    for (const [key, item] of prepared) {
      const now = new Date().toISOString();
      const sourceRefs = new Set(
        item.subject?.legacySources?.map((source) =>
          legacySourceRef(source.source, source.accountId),
        ) ?? [],
      );
      for (const candidate of item.candidates) sourceRefs.add(candidate.sourceRef);
      const legacySources: LegacyIdentitySource[] = [...sourceRefs].map((sourceRef) => {
        const separator = sourceRef.indexOf(":");
        return {
          source: sourceRef.slice(0, separator) as LegacyIdentitySource["source"],
          accountId: sourceRef.slice(separator + 1),
        };
      });
      const email =
        item.candidates.find((candidate) => candidate.email)?.email ??
        item.subject?.primaryEmail ??
        null;
      const hasPostParticleAccount = item.candidates.some(
        (candidate) => candidate.source === "postparticle",
      );
      const postParticleDisabled = item.candidates.some(
        (candidate) => candidate.source === "postparticle" && candidate.disabled,
      );
      let consumerProductStates = item.subject?.consumerProductStates ?? [];
      if (hasPostParticleAccount && products.postparticleProductId) {
        const previous = consumerProductStates.find(
          (state) => state.productId === products.postparticleProductId,
        );
        const status = postParticleDisabled ? "disabled" : "active";
        const productState: ConsumerProductState = {
          productId: products.postparticleProductId,
          status,
          sessionVersion:
            (previous?.sessionVersion ?? 1) + ((previous?.status ?? "active") !== status ? 1 : 0),
        };
        consumerProductStates = [
          ...consumerProductStates.filter(
            (state) => state.productId !== products.postparticleProductId,
          ),
          productState,
        ];
      }
      const credentialChanged =
        !item.subject?.passwordCredential ||
        item.subject.passwordCredential.encodedVerifier !== item.credential.encodedVerifier ||
        item.subject.passwordCredential.algorithm !== item.credential.algorithm;
      const subject: SubjectRecord = {
        ...(item.subject ?? ({} as SubjectRecord)),
        kind: "subject",
        schemaVersion: 1,
        subjectId: item.subject?.subjectId ?? newSubjectId(),
        status: item.subject?.status ?? "active",
        primaryEmail: email,
        emailVerifiedAt: item.subject?.emailVerifiedAt ?? null,
        emailVerificationExempt: true,
        loginIdentifiers: item.subject?.loginIdentifiers ?? [],
        legacySources,
        legacyCredentialSource: item.credentialSource,
        consumerProductStates,
        passwordCredential: credentialChanged ? item.credential : item.subject!.passwordCredential,
        authVersion: item.subject ? item.subject.authVersion + (credentialChanged ? 1 : 0) : 1,
        createdAt: item.subject?.createdAt ?? now,
        updatedAt: now,
      };
      const identifiers: ConsumerLoginIdentifier[] = [...(subject.loginIdentifiers ?? [])];
      for (const candidate of item.candidates) {
        if (
          candidate.source !== "postparticle" ||
          !candidate.username ||
          !products.postparticleProductId
        )
          continue;
        const existing = identifiers.find(
          (identifier) =>
            identifier.productId === products.postparticleProductId &&
            identifier.normalizedValue === candidate.username,
        );
        if (existing) continue;
        const existingSubjectId = await store().findSubjectIdByUsername(
          products.postparticleProductId,
          candidate.username,
        );
        if (existingSubjectId && existingSubjectId !== subject.subjectId) {
          throw new Error(`PostParticle username collision for ${candidate.username}.`);
        }
        identifiers.push({
          kind: "username",
          productId: products.postparticleProductId,
          value: candidate.username,
          normalizedValue: candidate.username,
        });
      }
      subject.loginIdentifiers = identifiers;
      const changed =
        !item.subject ||
        credentialChanged ||
        item.subject.status !== subject.status ||
        !item.subject.emailVerificationExempt ||
        JSON.stringify(item.subject.legacySources ?? []) !== JSON.stringify(legacySources) ||
        JSON.stringify(item.subject.consumerProductStates ?? []) !==
          JSON.stringify(consumerProductStates) ||
        JSON.stringify(item.subject.loginIdentifiers ?? []) !== JSON.stringify(identifiers);
      if (changed) {
        await persistRecord(subject, "legacy-import.identity", { kind: "system" });
      }
      subjectByKey.set(key, subject);
    }

    if (visitoring && products.visitoringProductId) {
      for (const membership of visitoring.memberships) {
        const key = visitoringRefToKey.get(membership.userId);
        const subject = key ? subjectByKey.get(key) : undefined;
        if (!subject || !consumerRoleActions("visitoring", membership.role)) continue;
        const scope = consumerResourceScope("visitoring", {
          organizationId: visitoring.organizationId,
          productId: products.visitoringProductId,
          scopeKind: "workspace",
          resourceId: membership.workspaceId,
        });
        await ensureConsumerProductMembershipUnlocked(
          subject,
          scope.organizationId,
          scope.productId,
        );
        await upsertImportedRoleGrantUnlocked(
          "visitoring",
          subject,
          scope,
          membership.role,
          consumerRoleActions("visitoring", membership.role)!,
          membership.active === false ? "disabled" : "active",
        );
      }
    }

    if (postparticle && products.postparticleProductId) {
      const policy = consumerProductPolicy("postparticle")!;
      for (const user of postparticle.users) {
        const username = normalizeProductUsername(user.username);
        const key = postparticleRefToKey.get(username);
        const subject = key ? subjectByKey.get(key) : undefined;
        if (!subject) continue;
        await ensureConsumerProductMembershipUnlocked(
          subject,
          postparticle.organizationId,
          products.postparticleProductId,
        );
        if (user.platformAdmin) {
          const productScope: ResourceScope = {
            kind: "product",
            organizationId: postparticle.organizationId as OrganizationId,
            productId: products.postparticleProductId,
          };
          await upsertImportedRoleGrantUnlocked(
            "postparticle",
            subject,
            productScope,
            "platform-admin",
            policy.platformAdminActions ?? [],
          );
        }
      }
      for (const membership of postparticle.memberships) {
        if (!membership.role) continue;
        const username = normalizeProductUsername(membership.username);
        const key = postparticleRefToKey.get(username);
        const subject = key ? subjectByKey.get(key) : undefined;
        if (!subject) continue;
        const scope = consumerResourceScope("postparticle", {
          organizationId: postparticle.organizationId,
          productId: products.postparticleProductId,
          scopeKind: "project",
          resourceId: membership.projectId,
        });
        await ensureConsumerProductMembershipUnlocked(
          subject,
          scope.organizationId,
          scope.productId,
        );
        await upsertImportedRoleGrantUnlocked(
          "postparticle",
          subject,
          scope,
          membership.role,
          consumerRoleActions("postparticle", membership.role)!,
        );
      }
    }
    report.applied = true;
    return report;
  });
}

function createInvitationDraft(
  actorId: SubjectId,
  organizationId: string,
  email: string,
  role: OrganizationInvitationRecord["role"],
  productId?: string,
): { invitation: OrganizationInvitationRecord; token: string } {
  const invitationId = newInvitationId();
  const token = `${invitationId}.${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  return {
    token,
    invitation: {
      kind: "organization-invitation",
      schemaVersion: 1,
      invitationId,
      organizationId: organizationId as OrganizationId,
      ...(productId ? { productId } : {}),
      email,
      role,
      verifierDigestHex: hashHex(token),
      createdBySubjectId: actorId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ORGANIZATION_INVITATION_LIFETIME_MS).toISOString(),
      consumedAt: null,
      revokedAt: null,
    },
  };
}

function activeInvitationsForScope(
  invitations: OrganizationInvitationRecord[],
  organizationId: string,
  productId?: string,
): OrganizationInvitationRecord[] {
  return invitations
    .filter(
      (invite) =>
        invite.organizationId === organizationId &&
        (productId === undefined ? !invite.productId : invite.productId === productId) &&
        !invite.consumedAt &&
        !invite.revokedAt &&
        Date.parse(invite.expiresAt) > Date.now(),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
      const { invitation, token } = createInvitationDraft(actorId, organizationId, email, role);
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
      const { invitation, token } = createInvitationDraft(
        actorId,
        organizationId,
        email,
        role,
        productId,
      );
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
    const invitations = (await listRecordsWithRecovery("organization-invitation")).map(
      (item) => item.record,
    );
    return activeInvitationsForScope(invitations, organizationId);
  });
}

export async function listProductInvitations(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<OrganizationInvitationRecord[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner", "admin"]);
    const invitations = (await listRecordsWithRecovery("organization-invitation")).map(
      (item) => item.record,
    );
    return activeInvitationsForScope(invitations, organizationId, productId);
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

export const listOrganizationPermissionGrants = cache(
  async function listOrganizationPermissionGrants(
    subjectId: SubjectId,
    organizationId: string,
  ): Promise<MembershipRecord[]> {
    return authMutationQueue.read(async () => {
      const catalogManager = await organizationMembershipUnlocked(organizationId, subjectId);
      let memberships: OrganizationMembershipRecord[];
      if (!catalogManager) {
        memberships = await store().listMembershipsForSubject(subjectId);
        if (
          !memberships.some(
            (item) =>
              item.organizationId === organizationId && item.productId && item.status === "active",
          )
        ) {
          throw new Error("Organization not found.");
        }
        memberships = memberships.filter(
          (membership) => membership.organizationId === organizationId && !!membership.productId,
        );
      } else {
        memberships = await store().listOrganizationMemberships(organizationId);
      }
      const isCatalogManager = !!catalogManager;
      return memberships
        .filter((membership) => !!membership.productId)
        .flatMap((membership) => membership.permissionGrants ?? [])
        .filter(
          (record) =>
            record.scope.organizationId === organizationId &&
            (isCatalogManager || record.subjectId === subjectId),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    });
  },
);

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
  firstName: string | null;
  lastName: string | null;
  status: SubjectRecord["status"];
  emailVerified: boolean;
  administrator: boolean;
  createdAt: string;
}

function publicAccount(subject: SubjectRecord): PublicAccount {
  return {
    subjectId: subject.subjectId,
    email: subject.primaryEmail,
    firstName: subject.firstName ?? null,
    lastName: subject.lastName ?? null,
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
  const common = {
    ...scope,
    organizationId: scope.organizationId.toLowerCase() as OrganizationId,
    productId: scope.productId.toLowerCase(),
  };
  const normalizedScope =
    scope.kind === "project"
      ? { ...common, projectId: scope.projectId.toLowerCase() }
      : scope.kind === "workspace"
        ? { ...common, workspaceId: scope.workspaceId.toLowerCase() }
        : common;
  const validPart = (value: string) => value.length <= 128 && /^[a-z0-9][a-z0-9._:-]*$/.test(value);
  assertOpaqueId(normalizedScope.organizationId);
  if (!validPart(normalizedScope.productId)) throw new Error("Enter a valid product ID.");
  if (normalizedScope.kind === "project" && !validPart(normalizedScope.projectId))
    throw new Error("Enter a valid project ID.");
  if (normalizedScope.kind === "workspace" && !validPart(normalizedScope.workspaceId))
    throw new Error("Enter a valid workspace ID.");
  return normalizedScope;
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
  accessRoleIdInput?: string,
): Promise<MembershipRecord> {
  assertOpaqueId(targetSubjectId);
  const scope = validateScope(scopeInput);
  const accessRoleId = accessRoleIdInput?.trim();
  if (accessRoleId && !/^role-[0-9a-f]{32}$/.test(accessRoleId)) {
    throw new Error("Choose a valid product access role.");
  }
  const customActions = accessRoleId ? null : validateActions(actionsInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const actorMembership = await requireProductRoleUnlocked(
        actorId,
        scope.organizationId,
        scope.productId,
        ["owner", "admin"],
      );
      const product = await store().readProduct(scope.organizationId, scope.productId);
      if (!product) throw new Error("Choose a product in this organization.");
      const role = accessRoleId
        ? product.accessRoles?.find((item) => item.id === accessRoleId)
        : undefined;
      if (accessRoleId && !role) {
        throw new Error("Choose an access role configured for this product.");
      }
      const actions = role ? validateActions(role.actions) : customActions;
      if (!actions) throw new Error("Enter 1 to 32 valid action names.");
      const target = await loadSubjectUnlocked(targetSubjectId);
      if (!target || target.status !== "active" || !isEmailVerifiedOrExempt(target)) {
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
        ...(role ? { accessRole: { id: role.id, name: role.name } } : {}),
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

function validateApiKeyOptions(options: CreateApiKeyOptions) {
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
  return { scope, actions, rotateId };
}

function createApiKeyDraft(
  owner: ApiKeyOwner,
  scope: ResourceScope,
  actions: readonly string[],
  expiresAt: string | null,
  previous: ApiKeyRecord | null,
): { record: ApiKeyRecord; token: string } {
  const apiKeyId = newApiKeyId();
  const token = `pmk_${apiKeyId}_${randomBytes(32).toString("base64url")}`;
  const record: ApiKeyRecord = {
    kind: "api-key",
    schemaVersion: 1,
    apiKeyId,
    keyClass: "integration",
    owner,
    scope,
    actions,
    verifier: { algorithm: "sha256", digestHex: hashHex(token) },
    status: "active",
    createdAt: new Date().toISOString(),
    expiresAt,
    revokedAt: null,
    rotatedFromApiKeyId: previous?.apiKeyId ?? null,
  };
  return { record, token };
}

async function findApiKeyToRotate(
  apiKeyId: string | undefined,
  owner: ApiKeyOwner,
  organizationId: string,
  ownerError: string,
): Promise<ApiKeyRecord | null> {
  if (!apiKeyId) return null;
  const existing = await loadRecord("api-key", apiKeyId);
  const matchesOwner =
    existing &&
    (owner.kind === "subject"
      ? existing.record.owner.kind === "subject" &&
        existing.record.owner.subjectId === owner.subjectId
      : existing.record.owner.kind === "service" &&
        existing.record.owner.servicePrincipalId === owner.servicePrincipalId);
  if (!existing || !matchesOwner) throw new Error(ownerError);
  if (
    existing.record.status !== "active" ||
    (existing.record.expiresAt && Date.parse(existing.record.expiresAt) <= Date.now())
  ) {
    throw new Error("Only an active, unexpired API key can be rotated.");
  }
  if (existing.record.scope.organizationId !== organizationId) {
    throw new Error("A key can only be rotated within its organization.");
  }
  return existing.record;
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
      const actor = await requireOrganizationRoleUnlocked(actorId, scope.organizationId, [
        "owner",
        "admin",
      ]);
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
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
  const normalizedOrganizationId = organizationId.toLowerCase();
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(actorId, normalizedOrganizationId, ["owner", "admin"]);
    return (await listRecordsWithRecovery("service-principal"))
      .map((item) => item.record)
      .filter(
        (principal) =>
          principal.organizationId === normalizedOrganizationId &&
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
  const { scope, actions, rotateId } = validateApiKeyOptions(options);
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
      const previous = await findApiKeyToRotate(
        rotateId,
        { kind: "service", servicePrincipalId: servicePrincipalId as ServicePrincipalId },
        scope.organizationId,
        "Choose one of this integration's API keys to rotate.",
      );
      await requireOrganizationProductUnlocked(scope.organizationId, scope.productId);
      const { record, token } = createApiKeyDraft(
        { kind: "service", servicePrincipalId: servicePrincipalId as ServicePrincipalId },
        scope,
        actions,
        options.expiresAt,
        previous,
      );
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
  const { scope, actions, rotateId } = validateApiKeyOptions(options);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(scope.organizationId, async () => {
      const subject = await loadSubjectUnlocked(subjectId);
      if (!subject || subject.status !== "active" || !isEmailVerifiedOrExempt(subject)) {
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
      const previous = await findApiKeyToRotate(
        rotateId,
        { kind: "subject", subjectId },
        scope.organizationId,
        "Choose one of your own API keys to rotate.",
      );
      const { record, token } = createApiKeyDraft(
        { kind: "subject", subjectId },
        scope,
        actions,
        options.expiresAt,
        previous,
      );
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

export const listApiKeysForSubject = cache(async function listApiKeysForSubject(
  subjectId: SubjectId,
): Promise<ApiKeyRecord[]> {
  return authMutationQueue.read(async () => {
    const keys = await store().listApiKeysForSubject(subjectId);
    return keys.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
});

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
    grantScope.organizationId.toLowerCase() !== request.organizationId.toLowerCase() ||
    grantScope.productId.toLowerCase() !== request.productId.toLowerCase()
  )
    return false;
  if (grantScope.kind === "product") return true;
  if (grantScope.kind !== request.kind) return false;
  if (grantScope.kind === "project" && request.kind === "project")
    return grantScope.projectId.toLowerCase() === request.projectId.toLowerCase();
  if (grantScope.kind === "workspace" && request.kind === "workspace")
    return grantScope.workspaceId.toLowerCase() === request.workspaceId.toLowerCase();
  return false;
}

function keyScopeAllows(keyScope: ResourceScope, request: ResourceScope): boolean {
  if (
    keyScope.organizationId.toLowerCase() !== request.organizationId.toLowerCase() ||
    keyScope.productId.toLowerCase() !== request.productId.toLowerCase()
  )
    return false;
  if (keyScope.kind === "product") return true;
  if (keyScope.kind !== request.kind) return false;
  if (keyScope.kind === "project" && request.kind === "project")
    return keyScope.projectId.toLowerCase() === request.projectId.toLowerCase();
  if (keyScope.kind === "workspace" && request.kind === "workspace")
    return keyScope.workspaceId.toLowerCase() === request.workspaceId.toLowerCase();
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
  if (!subject || subject.record.status !== "active" || !isEmailVerifiedOrExempt(subject.record)) {
    return { authorized: false };
  }
  if (consumerProductState(subject.record, scope.productId).status !== "active") {
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
        (!record.productId ||
          (consumerProductState(subject, record.productId).status === "active" &&
            consumerProductState(subject, record.productId).sessionVersion ===
              (record.productSessionVersion ?? 1))) &&
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
