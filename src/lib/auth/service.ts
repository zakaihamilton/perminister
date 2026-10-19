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
  newConsumerAuthorizationCodeId,
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
  type ConsumerAuthorizationCodeId,
  type ConsumerAuthorizationCodeRecord,
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
const SESSION_SUBJECT_CACHE_MAX_ENTRIES = 512;

const sessionSubjectCache = new Map<string, SubjectId>();

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

function legacySaltedScrypt(password: string, salt: string): Promise<Buffer> {
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
  if (/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(credential.encodedVerifier)) {
    const match = /^([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(credential.encodedVerifier);
    if (!match) {
      await scrypt(password, Buffer.alloc(16, 4));
      return false;
    }
    try {
      const expected = Buffer.from(match[2], "hex");
      const actual = await legacySaltedScrypt(password, match[1]);
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
    case "consumer-authorization-code":
      return { kind, id: id as ConsumerAuthorizationCodeId };
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
  } else if (record.kind === "membership") {
    payload.organizationId = record.scope.organizationId;
    payload.productId = record.scope.productId;
    payload.subjectId = record.subjectId;
    if (record.accessRole?.name) payload.accessRoleName = record.accessRole.name;
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

async function persistRecord(
  record: AuthRecord,
  type: string,
  actor: AuthActor,
  additionalPayload: AuthEvent["payload"] = {},
): Promise<void> {
  const objectStore = store();
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
  invalidateOrganizationDashboardDataCache();
  await appendRecordActivityEvent(record, type, actor, additionalPayload);
}

async function appendRecordActivityEvent(
  record: AuthRecord,
  type: string,
  actor: AuthActor,
  additionalPayload: AuthEvent["payload"] = {},
): Promise<void> {
  const objectStore = store();
  const id = authRecordId(record);
  const event: AuthEvent = {
    schemaVersion: 1,
    eventId: newEventId(),
    aggregate: aggregateFor(record.kind, id),
    aggregateVersion: 1,
    occurredAt: new Date().toISOString(),
    actor,
    type,
    payload: { ...activityPayload(record), ...additionalPayload },
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
  return value && !value.record.deletedAt ? value.record : null;
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
  return authMutationQueue.run(() =>
    createConsumerSessionUnlocked(subjectId, clientId, normalizedProductId, sessionLifetimeMs),
  );
}

async function createConsumerSessionUnlocked(
  subjectId: SubjectId,
  clientId: string,
  productId: string,
  sessionLifetimeMs: number,
): Promise<{ session: SessionRecord; token: string }> {
  const subject = await loadSubjectUnlocked(subjectId);
  requireVerifiedActiveSubject(subject);
  const productState = consumerProductState(subject, productId);
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
    productId,
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
}

export class InvalidConsumerAuthorizationCodeError extends Error {
  constructor() {
    super("The authorization code is invalid, expired, or already used.");
    this.name = "InvalidConsumerAuthorizationCodeError";
  }
}

export async function createConsumerAuthorizationCode(
  subjectId: SubjectId,
  clientId: string,
  codeChallenge: string,
): Promise<string> {
  assertOpaqueId(clientId);
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new Error("Choose a valid PKCE challenge.");
  }
  return authMutationQueue.run(async () => {
    const client = await loadRecord("consumer-client", clientId);
    if (!client || client.record.status !== "active" || !client.record.appOrigin) {
      throw new Error("Choose an active application client with an app origin.");
    }
    const subject = await loadSubjectUnlocked(subjectId);
    requireVerifiedActiveSubject(subject);
    const productState = consumerProductState(subject, client.record.productId);
    if (productState.status !== "active") {
      throw new Error("This account is disabled for the application.");
    }
    const codeId = newConsumerAuthorizationCodeId();
    const code = `${codeId}.${randomBytes(32).toString("base64url")}`;
    const now = new Date();
    const record: ConsumerAuthorizationCodeRecord = {
      kind: "consumer-authorization-code",
      schemaVersion: 1,
      consumerAuthorizationCodeId: codeId,
      consumerClientId: client.record.consumerClientId,
      subjectId,
      authVersion: subject.authVersion,
      productSessionVersion: productState.sessionVersion,
      codeDigestHex: hashHex(code),
      codeChallenge,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      consumedAt: null,
    };
    await persistRecord(record, "consumer-authorization-code.issued", {
      kind: "subject",
      subjectId,
    });
    return code;
  });
}

export async function exchangeConsumerAuthorizationCode(
  code: string,
  clientId: string,
  codeVerifier: string,
): Promise<{ session: SessionRecord; token: string; subject: SubjectRecord; productId: string }> {
  assertOpaqueId(clientId);
  if (code.length > 128 || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) {
    throw new InvalidConsumerAuthorizationCodeError();
  }
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(code);
  if (!match) throw new InvalidConsumerAuthorizationCodeError();
  const codeChallenge = createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
  return authMutationQueue.run(async () => {
    const [authorization, client] = await Promise.all([
      loadRecord("consumer-authorization-code", match[1]),
      loadRecord("consumer-client", clientId),
    ]);
    if (
      !authorization ||
      !client ||
      client.record.status !== "active" ||
      authorization.record.consumerClientId !== clientId ||
      authorization.record.consumedAt ||
      Date.parse(authorization.record.expiresAt) <= Date.now() ||
      !equalHex(authorization.record.codeDigestHex, hashHex(code))
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    const expectedChallenge = Buffer.from(authorization.record.codeChallenge, "utf8");
    const actualChallenge = Buffer.from(codeChallenge, "utf8");
    if (
      expectedChallenge.length !== actualChallenge.length ||
      !timingSafeEqual(expectedChallenge, actualChallenge)
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    const productStateSubject = await loadSubjectUnlocked(authorization.record.subjectId);
    const productState = productStateSubject
      ? consumerProductState(productStateSubject, client.record.productId)
      : null;
    if (
      !productStateSubject ||
      productStateSubject.status !== "active" ||
      productStateSubject.authVersion !== authorization.record.authVersion ||
      productState?.status !== "active" ||
      productState.sessionVersion !== authorization.record.productSessionVersion
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    const consumedAt = new Date().toISOString();
    await persistRecord(
      { ...authorization.record, consumedAt },
      "consumer-authorization-code.consumed",
      { kind: "subject", subjectId: authorization.record.subjectId },
    );
    const created = await createConsumerSessionUnlocked(
      authorization.record.subjectId,
      client.record.consumerClientId,
      client.record.productId,
      client.record.sessionLifetimeMs,
    );
    return {
      ...created,
      subject: productStateSubject,
      productId: client.record.productId,
    };
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
    const sessionId = match[1] as SessionId;
    const knownSubjectId = sessionSubjectCache.get(sessionId);
    const [session, knownSubject] = await Promise.all([
      loadRecord("session", sessionId),
      knownSubjectId ? loadRecord("subject", knownSubjectId) : Promise.resolve(null),
    ]);
    if (!session) return null;
    const record = session.record;
    if (
      record.revokedAt ||
      Date.parse(record.expiresAt) <= Date.now() ||
      !equalHex(record.verifierDigestHex, hashHex(token))
    )
      return null;
    const subject =
      knownSubjectId === record.subjectId
        ? knownSubject
        : await loadRecord("subject", record.subjectId);
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
    rememberSessionSubject(sessionId, record.subjectId);
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

export interface OrganizationDashboardData {
  organization: OrganizationSummary;
  organizations: OrganizationSummary[];
  products: ProductRecord[];
}

type OrganizationDashboardCacheEntry = {
  data: OrganizationDashboardData;
  memberships: OrganizationMembershipRecord[];
  expiresAt: number;
};

const ORGANIZATION_DASHBOARD_CACHE_TTL_MS = 30_000;
const ORGANIZATION_DASHBOARD_CACHE_MAX_ENTRIES = 128;
const organizationDashboardDataCache = new Map<string, OrganizationDashboardCacheEntry>();

function organizationDashboardCacheKey(subjectId: SubjectId, organizationId: string): string {
  return JSON.stringify([subjectId, organizationId]);
}

function getCachedOrganizationDashboardData(
  subjectId: SubjectId,
  organizationId: string,
): OrganizationDashboardCacheEntry | null {
  const key = organizationDashboardCacheKey(subjectId, organizationId);
  const entry = organizationDashboardDataCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    organizationDashboardDataCache.delete(key);
    return null;
  }
  organizationDashboardDataCache.delete(key);
  organizationDashboardDataCache.set(key, entry);
  return entry;
}

function setCachedOrganizationDashboardData(
  subjectId: SubjectId,
  organizationId: string,
  data: OrganizationDashboardData,
  memberships: OrganizationMembershipRecord[],
): void {
  const key = organizationDashboardCacheKey(subjectId, organizationId);
  if (
    !organizationDashboardDataCache.has(key) &&
    organizationDashboardDataCache.size >= ORGANIZATION_DASHBOARD_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = organizationDashboardDataCache.keys().next().value;
    if (oldestKey !== undefined) organizationDashboardDataCache.delete(oldestKey);
  }
  organizationDashboardDataCache.delete(key);
  organizationDashboardDataCache.set(key, {
    data,
    memberships,
    expiresAt: Date.now() + ORGANIZATION_DASHBOARD_CACHE_TTL_MS,
  });
}

function invalidateOrganizationDashboardDataCache(): void {
  organizationDashboardDataCache.clear();
}

function rememberSessionSubject(sessionId: string, subjectId: SubjectId): void {
  sessionSubjectCache.delete(sessionId);
  sessionSubjectCache.set(sessionId, subjectId);
  if (sessionSubjectCache.size > SESSION_SUBJECT_CACHE_MAX_ENTRIES) {
    const oldestSessionId = sessionSubjectCache.keys().next().value;
    if (oldestSessionId !== undefined) sessionSubjectCache.delete(oldestSessionId);
  }
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

const PLATFORM_AUDIT_PAGE_SIZE = 25;
const PLATFORM_AUDIT_MAX_EVENTS = 100;
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
  "product.created": "Created a product",
  "product.member-added": "Added a product member",
  "product.member-keys-revoked": "Revoked a removed member's API keys",
  "product.member-removed": "Removed a product member",
  "product.member-reactivated": "Reactivated a product member",
  "product.member-role-updated": "Changed a product member role",
  "product.owner-assigned": "Assigned a product owner",
  "product.published": "Published a product",
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

function eventPayloadId(event: AuthEvent, key: string): string | null {
  const value = event.payload[key];
  if (typeof value !== "string") return null;
  try {
    assertOpaqueId(value);
    return value;
  } catch {
    return null;
  }
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
  if (event.type === "product.transferred" && typeof event.payload.productName === "string") {
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

const ACTIVITY_CHANGE_LABELS: Readonly<Record<string, string>> = {
  actions: "Allowed actions",
  role: "Role",
  status: "Status",
};

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

function activityBelongsToOrganization(event: AuthEvent, organizationId: string): boolean {
  const eventOrganizationId =
    typeof event.payload.organizationId === "string"
      ? event.payload.organizationId
      : event.aggregate.kind === "organization"
        ? event.aggregate.id
        : null;
  return eventOrganizationId === organizationId;
}

async function organizationActivityEntries(
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
  const entries = events.map((event) => {
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
  return entries;
}

async function platformActivityEntries(
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
        ...(event.type === "product.transferred"
          ? [
              {
                label: "Transfer",
                value: `${event.payload.productName ?? entry.target} transferred from ${
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
  const [actor, organization, membership] = await Promise.all([
    loadSubjectUnlocked(actorId),
    loadApprovedOrganizationUnlocked(organizationId),
    organizationMembershipUnlocked(organizationId, actorId),
  ]);
  requireVerifiedActiveSubject(actor);
  if (!organization) throw new Error("Organization not found.");
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
    await persistRecord(
      membership,
      "organization.member-added",
      { kind: "subject", subjectId },
      { changes: [{ field: "role", before: "None", after: membership.role }] },
    );
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

async function pendingOrganizationsForAdministratorUnlocked(
  actorId: SubjectId,
): Promise<OrganizationRecord[]> {
  await requireAdministrator(actorId);
  return (await listRecordsWithRecovery("organization"))
    .map((item) => item.record)
    .filter((organization) => organizationApprovalStatus(organization) === "pending");
}

export async function countPendingOrganizationsForAdministrator(
  actorId: SubjectId,
): Promise<number> {
  return authMutationQueue.read(async () => {
    const organizations = await pendingOrganizationsForAdministratorUnlocked(actorId);
    return organizations.length;
  });
}

export async function listPendingOrganizationsForAdministrator(
  actorId: SubjectId,
): Promise<OrganizationReviewRequest[]> {
  return authMutationQueue.run(async () => {
    const organizations = (await pendingOrganizationsForAdministratorUnlocked(actorId)).sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt),
    );
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
  return authMutationQueue.read(async () => {
    const organizationMemberships = await store().listMembershipsForSubject(subjectId);
    const activeMemberships = new Map<string, OrganizationMembershipRecord>();
    const grantsByOrganization = new Map<string, MembershipRecord[]>();
    for (const membership of organizationMemberships) {
      for (const grant of membership.permissionGrants ?? []) {
        if (
          grant.subjectId !== subjectId ||
          grant.status !== "active" ||
          grant.scope.productId !== normalizedProductId
        ) {
          continue;
        }
        const organizationGrants = grantsByOrganization.get(grant.scope.organizationId) ?? [];
        organizationGrants.push(grant);
        grantsByOrganization.set(grant.scope.organizationId, organizationGrants);
      }
      if (
        membership.subjectId !== subjectId ||
        membership.status !== "active" ||
        (membership.productId && membership.productId !== normalizedProductId)
      ) {
        continue;
      }
      const existing = activeMemberships.get(membership.organizationId);
      if (!existing || (existing.productId && !membership.productId)) {
        activeMemberships.set(membership.organizationId, membership);
      }
    }
    const results = await mapWithConcurrency<
      OrganizationMembershipRecord,
      ConsumerOrganizationAccess | null
    >([...activeMemberships.values()], async (membership) => {
      const [productResult, organizationResult] = await Promise.allSettled([
        store().readProduct(membership.organizationId, normalizedProductId),
        loadRecord("organization", membership.organizationId),
      ]);
      if (productResult.status === "rejected") throw productResult.reason;
      if (!productResult.value) return null;
      if (organizationResult.status === "rejected") throw organizationResult.reason;
      const organization = organizationResult.value;
      if (!organization) return null;
      const scopedMemberships = grantsByOrganization.get(membership.organizationId) ?? [];
      const permissions = scopedMemberships.flatMap((grant) => grant.grants);
      return {
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
      };
    });
    return results
      .filter((result): result is ConsumerOrganizationAccess => result !== null)
      .sort((left, right) => left.organizationName.localeCompare(right.organizationName));
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

export const countOrganizationMembersForSubject = cache(
  async function countOrganizationMembersForSubject(
    actorId: SubjectId,
    organizationId: string,
  ): Promise<number> {
    return authMutationQueue.read(async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
      const memberships = await store().listOrganizationMemberships(organizationId);
      return memberships.filter(
        (membership) => !membership.productId && membership.status === "active",
      ).length;
    });
  },
);

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
      await persistRecord(
        next,
        "organization.member-role-updated",
        {
          kind: "subject",
          subjectId: actorMembership.subjectId,
        },
        {
          changes: [{ field: "role", before: membership.role, after: role }],
        },
      );
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
      await persistRecord(
        ownerMembership,
        "product.owner-assigned",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          changes: [{ field: "role", before: "None", after: ownerMembership.role }],
        },
      );
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

export interface AdministratorPublicProductTransferEntry {
  product: ProductRecord;
  publisherOrganizationName: string;
  adopterCount: number;
  destinations: ProductTransferDestination[];
  pendingDestinationOrganizationId?: string;
}

export interface ProductTransferDestination {
  organizationId: string;
  name: string;
  disabledReason?: string;
  transferNotice?: string;
}

export interface OrganizationProductTransferOptions {
  destinations: ProductTransferDestination[];
  pendingDestinationOrganizationId?: string;
}

function isSharedProductSource(product: ProductRecord): boolean {
  return !product.sharedProductRef && product.visibility === "public";
}

async function hasAnotherPublicPublisherUnlocked(product: ProductRecord): Promise<boolean> {
  return (await listRecordsWithRecovery("product")).some(
    (entry) =>
      entry.record.organizationId !== product.organizationId &&
      entry.record.productId === product.productId &&
      isSharedProductSource(entry.record),
  );
}

function publicProductTransferTargetId(
  sourceProductRecordId: ProductRecordId,
  destinationOrganizationId: string,
): ProductRecordId {
  const bytes = createHash("sha256")
    .update(
      `perminister:public-product-transfer:v1:${sourceProductRecordId}:${destinationOrganizationId}`,
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as ProductRecordId;
}

async function completedProductTransferTargetsUnlocked(
  sourceProductRecordId: ProductRecordId,
): Promise<Set<string>> {
  const events = await store().listEvents({ kind: "product", id: sourceProductRecordId });
  return new Set(
    events
      .filter((event) => event.type === "product.transferred")
      .map((event) => eventPayloadId(event, "destinationProductRecordId"))
      .filter((targetId): targetId is string => targetId !== null),
  );
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

function isActiveSharedInstallationForSource(
  installation: ProductRecord,
  source: ProductRecord,
): boolean {
  return (
    installation.productId === source.productId &&
    installation.organizationId !== source.organizationId &&
    !installation.sharedProductRef?.detachedAt &&
    refersToSharedProduct(installation, source)
  );
}

function isPendingSharedInstallationTransfer(
  installation: ProductRecord,
  source: ProductRecord,
): boolean {
  return (
    installation.visibility === "private" &&
    isActiveSharedInstallationForSource(installation, source)
  );
}

function isPotentialProductTransferTarget(
  candidate: ProductRecord,
  source: ProductRecord,
): boolean {
  return (
    candidate.productId === source.productId &&
    candidate.organizationId !== source.organizationId &&
    ((candidate.productRecordId ===
      publicProductTransferTargetId(source.productRecordId, candidate.organizationId) &&
      !candidate.sharedProductRef) ||
      isPendingSharedInstallationTransfer(candidate, source))
  );
}

function publicProductTransferDestinations(
  source: ProductRecord,
  organizations: readonly OrganizationRecord[],
  products: readonly ProductRecord[],
  pendingTargets: readonly ProductRecord[],
): ProductTransferDestination[] {
  const pendingDestinationOrganizationId = pendingTargets[0]?.organizationId;
  const pendingDestinationName = organizations.find(
    (organization) => organization.organizationId === pendingDestinationOrganizationId,
  )?.name;

  return organizations
    .map((organization) => {
      const organizationId = organization.organizationId;
      const destinationProducts = products.filter(
        (product) =>
          product.organizationId === organizationId && product.productId === source.productId,
      );
      const pendingTarget = pendingTargets.find(
        (target) => target.organizationId === organizationId,
      );
      const hasReusableProduct =
        destinationProducts.length === 1 &&
        (isActiveSharedInstallationForSource(destinationProducts[0], source) ||
          destinationProducts[0].productRecordId === pendingTarget?.productRecordId ||
          !destinationProducts[0].sharedProductRef ||
          !!destinationProducts[0].sharedProductRef.detachedAt);
      const replacesExistingProduct =
        destinationProducts.length === 1 &&
        ((!destinationProducts[0].sharedProductRef && !pendingTarget) ||
          !!destinationProducts[0].sharedProductRef?.detachedAt ||
          (!!pendingTarget &&
            pendingTarget.productRecordId !==
              publicProductTransferTargetId(source.productRecordId, organizationId)));

      let disabledReason: string | undefined;
      if (organizationId === source.organizationId) {
        disabledReason = "Already the publisher";
      } else if (organizationApprovalStatus(organization) !== "approved") {
        disabledReason =
          organizationApprovalStatus(organization) === "pending"
            ? "Waiting for organization approval"
            : "Organization is not approved";
      } else if (pendingTargets.length > 0 && !pendingTarget) {
        disabledReason = `Finish the transfer to ${pendingDestinationName ?? "its current destination"} first`;
      } else if (destinationProducts.length > 0 && !hasReusableProduct) {
        disabledReason = "Product ID is linked to another publisher";
      }

      return {
        organizationId,
        name: organization.name,
        disabledReason,
        transferNotice: replacesExistingProduct
          ? "Existing product details will be replaced"
          : undefined,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isPendingProductTransferTarget(
  candidate: ProductRecord,
  source: ProductRecord,
  completedTargets: ReadonlySet<string>,
): boolean {
  return (
    isPotentialProductTransferTarget(candidate, source) &&
    !completedTargets.has(candidate.productRecordId)
  );
}

function transferDestinationProductRecordId(
  source: ProductRecord,
  destinationOrganizationId: string,
  products: readonly ProductRecord[],
  completedTargets: ReadonlySet<string>,
): ProductRecordId {
  const pendingTarget = products.find(
    (candidate) =>
      candidate.organizationId === destinationOrganizationId &&
      isPendingProductTransferTarget(candidate, source, completedTargets),
  );
  if (pendingTarget) return pendingTarget.productRecordId;

  const existingInstallation = products.find(
    (candidate) =>
      candidate.organizationId === destinationOrganizationId &&
      isActiveSharedInstallationForSource(candidate, source),
  );
  const existingLocalProduct = products.find(
    (candidate) =>
      candidate.organizationId === destinationOrganizationId &&
      candidate.productId === source.productId &&
      (!candidate.sharedProductRef || !!candidate.sharedProductRef.detachedAt),
  );
  return (
    existingInstallation?.productRecordId ??
    existingLocalProduct?.productRecordId ??
    publicProductTransferTargetId(source.productRecordId, destinationOrganizationId)
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
): Promise<ProductShareInfo | null> {
  assertOpaqueId(productRecordId);
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const found = await loadRecord("product", productRecordId);
    if (!found || found.record.organizationId !== organizationId || found.record.sharedProductRef) {
      throw new Error("Product not found.");
    }
    if (await hasAnotherPublicPublisherUnlocked(found.record)) return null;

    const installations = await sharedInstallationsForSourceUnlocked(found.record);
    return {
      visibility: found.record.visibility === "public" ? "public" : "private",
      adopterOrganizations: await organizationNamesForInstallationsUnlocked(installations),
    };
  });
}

export async function listPublicProductsForAdministrator(
  actorId: SubjectId,
): Promise<AdministratorPublicProductTransferEntry[]> {
  return authMutationQueue.read(async () => {
    await requireAdministrator(actorId);
    const [productRows, organizationRows] = await Promise.all([
      listRecordsWithRecovery("product"),
      listRecordsWithRecovery("organization"),
    ]);
    const products = productRows.map((entry) => entry.record);
    const organizations = organizationRows.map((entry) => entry.record);
    const organizationsById = new Map(
      organizations.map((organization) => [organization.organizationId, organization]),
    );

    const candidateSources = products.filter(
      (product) =>
        isSharedProductSource(product) ||
        products.some((candidate) => isPotentialProductTransferTarget(candidate, product)),
    );
    const entries = await Promise.all(
      candidateSources.map(async (product) => {
        const potentialTransferTargets = products.filter((candidate) =>
          isPotentialProductTransferTarget(candidate, product),
        );
        const completedTransfers = potentialTransferTargets.length
          ? await completedProductTransferTargetsUnlocked(product.productRecordId)
          : new Set<string>();
        const pendingTransferTargets = potentialTransferTargets.filter(
          (candidate) => !completedTransfers.has(candidate.productRecordId),
        );
        if (!isSharedProductSource(product) && !pendingTransferTargets.length) return null;
        const publisher = organizationsById.get(product.organizationId);
        if (!publisher) return null;
        const adopterCount = products.filter(
          (candidate) =>
            !candidate.sharedProductRef?.detachedAt &&
            (refersToSharedProduct(candidate, product) ||
              pendingTransferTargets.some((target) => refersToSharedProduct(candidate, target))),
        ).length;
        return {
          product,
          publisherOrganizationName: publisher.name,
          adopterCount,
          destinations: publicProductTransferDestinations(
            product,
            organizations,
            products,
            pendingTransferTargets,
          ),
          pendingDestinationOrganizationId: pendingTransferTargets[0]?.organizationId,
        };
      }),
    );

    return entries
      .filter((entry) => entry !== null)
      .sort(
        (left, right) =>
          left.product.name.localeCompare(right.product.name) ||
          left.publisherOrganizationName.localeCompare(right.publisherOrganizationName),
      );
  });
}

export async function getOwnedPublicProductTransferOptions(
  actorId: SubjectId,
  sourceOrganizationId: string,
  productRecordId: string,
): Promise<OrganizationProductTransferOptions> {
  assertOpaqueId(productRecordId);
  return authMutationQueue.read(async () => {
    await requireOrganizationRoleUnlocked(actorId, sourceOrganizationId, ["owner"]);
    const found = await loadRecord("product", productRecordId);
    if (
      !found ||
      found.record.organizationId !== sourceOrganizationId ||
      found.record.sharedProductRef
    ) {
      return { destinations: [] };
    }

    const [productRows, organizationRows, memberships] = await Promise.all([
      listRecordsWithRecovery("product"),
      listRecordsWithRecovery("organization"),
      store().listMembershipsForSubject(actorId),
    ]);
    const products = productRows.map((entry) => entry.record);
    const organizations = organizationRows.map((entry) => entry.record);
    const ownedOrganizationIds = new Set(
      memberships
        .filter(
          (membership) =>
            !membership.productId && membership.role === "owner" && membership.status === "active",
        )
        .map((membership) => membership.organizationId),
    );
    const ownedOrganizations = organizations.filter(
      (organization) =>
        ownedOrganizationIds.has(organization.organizationId) &&
        organization.organizationId !== sourceOrganizationId,
    );
    const potentialTransferTargets = products.filter((candidate) =>
      isPotentialProductTransferTarget(candidate, found.record),
    );
    const completedTargets = potentialTransferTargets.length
      ? await completedProductTransferTargetsUnlocked(found.record.productRecordId)
      : new Set<string>();
    const pendingTransferTargets = potentialTransferTargets.filter(
      (candidate) => !completedTargets.has(candidate.productRecordId),
    );
    if (!isSharedProductSource(found.record) && !pendingTransferTargets.length) {
      return { destinations: [] };
    }

    const destinations = publicProductTransferDestinations(
      found.record,
      ownedOrganizations,
      products,
      pendingTransferTargets,
    );

    return {
      destinations,
      pendingDestinationOrganizationId: pendingTransferTargets.find((target) =>
        ownedOrganizationIds.has(target.organizationId),
      )?.organizationId,
    };
  });
}

export interface PublicProductTransferResult {
  product: ProductRecord;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  affectedOrganizationIds: string[];
}

type PublicProductTransferAuthority = "administrator" | "organization-owner";

async function requirePublicProductTransferAuthority(
  actorId: SubjectId,
  sourceOrganizationId: string,
  destinationOrganizationId: string,
  authority: PublicProductTransferAuthority,
): Promise<void> {
  if (authority === "administrator") {
    await requireAdministrator(actorId);
    return;
  }
  await requireOrganizationRoleUnlocked(actorId, sourceOrganizationId, ["owner"]);
  await requireOrganizationRoleUnlocked(actorId, destinationOrganizationId, ["owner"]);
}

async function transferPublicProduct(
  actorId: SubjectId,
  productRecordId: string,
  destinationOrganizationId: string,
  authority: PublicProductTransferAuthority,
  sourceOrganizationId?: string,
): Promise<PublicProductTransferResult> {
  assertOpaqueId(productRecordId);
  assertOpaqueId(destinationOrganizationId);
  return authMutationQueue.run(async () => {
    if (authority === "administrator") {
      await requireAdministrator(actorId);
    } else {
      if (!sourceOrganizationId) throw new Error("Organization not found.");
      await requireOrganizationRoleUnlocked(actorId, sourceOrganizationId, ["owner"]);
    }
    const initial = await loadRecord("product", productRecordId);
    if (
      !initial ||
      initial.record.sharedProductRef ||
      (sourceOrganizationId && initial.record.organizationId !== sourceOrganizationId)
    ) {
      throw new Error("Only a public publisher product can be transferred.");
    }
    const initialSource = initial.record;
    await requirePublicProductTransferAuthority(
      actorId,
      initialSource.organizationId,
      destinationOrganizationId,
      authority,
    );
    const initialProducts = (await listRecordsWithRecovery("product")).map((entry) => entry.record);
    const initialCompletedTargets = await completedProductTransferTargetsUnlocked(
      initialSource.productRecordId,
    );
    const initialDestinationProductRecordId = transferDestinationProductRecordId(
      initialSource,
      destinationOrganizationId,
      initialProducts,
      initialCompletedTargets,
    );
    const initialPendingTargets = initialProducts.filter((product) =>
      isPendingProductTransferTarget(product, initialSource, initialCompletedTargets),
    );
    const canResumeInitialTransfer = initialPendingTargets.some(
      (product) => product.organizationId === destinationOrganizationId,
    );
    if (!isSharedProductSource(initialSource) && !canResumeInitialTransfer) {
      throw new Error("Only a public publisher product can be transferred.");
    }
    const initialDestinationProduct: ProductRecord = {
      ...initialSource,
      productRecordId: initialDestinationProductRecordId,
      organizationId: destinationOrganizationId as OrganizationId,
      visibility: "public",
    };
    const initialInstallations = initialProducts.filter(
      (product) =>
        !product.sharedProductRef?.detachedAt &&
        (refersToSharedProduct(product, initialSource) ||
          refersToSharedProduct(product, initialDestinationProduct)),
    );
    const lockIds = [
      initialSource.organizationId,
      destinationOrganizationId,
      ...initialInstallations.map((installation) => installation.organizationId),
    ];

    return withOrganizationMutationLocks(lockIds, async () => {
      const sourceRecord = await loadRecord("product", productRecordId);
      if (!sourceRecord || sourceRecord.record.sharedProductRef) {
        throw new Error("Only a public publisher product can be transferred.");
      }
      const source = sourceRecord.record;
      if (sourceOrganizationId && source.organizationId !== sourceOrganizationId) {
        throw new Error("Only a public publisher product can be transferred.");
      }
      await requirePublicProductTransferAuthority(
        actorId,
        source.organizationId,
        destinationOrganizationId,
        authority,
      );
      if (destinationOrganizationId === source.organizationId) {
        throw new Error("Choose a different destination organization.");
      }
      if (!(await loadApprovedOrganizationUnlocked(destinationOrganizationId))) {
        throw new Error("Choose an approved destination organization.");
      }

      const products = (await listRecordsWithRecovery("product")).map((entry) => entry.record);
      const completedTargets = await completedProductTransferTargetsUnlocked(
        source.productRecordId,
      );
      const pendingTargets = products.filter((product) =>
        isPendingProductTransferTarget(product, source, completedTargets),
      );
      if (pendingTargets.some((product) => product.organizationId !== destinationOrganizationId)) {
        throw new Error(
          "This product has an incomplete transfer. Resume it at its existing destination first.",
        );
      }

      const destinationProductRecordId = transferDestinationProductRecordId(
        source,
        destinationOrganizationId,
        products,
        completedTargets,
      );
      const destinationRecord = await loadRecord("product", destinationProductRecordId);
      if (
        destinationRecord &&
        (destinationRecord.record.organizationId !== destinationOrganizationId ||
          destinationRecord.record.productId !== source.productId ||
          (destinationRecord.record.sharedProductRef &&
            !destinationRecord.record.sharedProductRef.detachedAt &&
            !isActiveSharedInstallationForSource(destinationRecord.record, source)))
      ) {
        throw new Error("The previous transfer cannot be resumed safely.");
      }
      const pendingAtDestination = pendingTargets.some(
        (product) => product.productRecordId === destinationProductRecordId,
      );
      if (!isSharedProductSource(source) && !pendingAtDestination) {
        throw new Error("Only a public publisher product can be transferred.");
      }

      const destinationConflicts = products.filter(
        (product) =>
          product.organizationId === destinationOrganizationId &&
          product.productId === source.productId,
      );
      const destinationHasAdopterInstallation =
        destinationConflicts.length === 1 &&
        destinationConflicts[0].productRecordId === destinationProductRecordId &&
        isActiveSharedInstallationForSource(destinationConflicts[0], source);
      const destinationHasReusableProduct =
        destinationConflicts.length === 1 &&
        destinationConflicts[0].productRecordId === destinationProductRecordId &&
        (!destinationConflicts[0].sharedProductRef ||
          !!destinationConflicts[0].sharedProductRef.detachedAt ||
          destinationHasAdopterInstallation);
      if (
        destinationConflicts.length > 1 ||
        destinationConflicts.some(
          (product) => product.productRecordId !== destinationProductRecordId,
        ) ||
        (destinationConflicts.length > 0 && !pendingAtDestination && !destinationHasReusableProduct)
      ) {
        throw new Error("The destination already has a product with this product ID.");
      }

      const destinationProduct: ProductRecord = {
        ...source,
        productRecordId: destinationProductRecordId,
        organizationId: destinationOrganizationId as OrganizationId,
        visibility: "public",
        updatedAt: new Date().toISOString(),
      };
      const destinationAdopterInstallation = destinationHasAdopterInstallation
        ? destinationConflicts[0]
        : undefined;
      const pendingDestinationProduct: ProductRecord = {
        ...destinationProduct,
        visibility: "private",
        sharedProductRef: {
          sourceOrganizationId: source.organizationId,
          sourceProductRecordId: source.productRecordId,
          sourceProductId: source.productId,
          detachedAt: null,
        },
      };
      const installations = products.filter(
        (installation) =>
          !installation.sharedProductRef?.detachedAt &&
          (refersToSharedProduct(installation, source) ||
            refersToSharedProduct(installation, destinationProduct)),
      );
      const sourcePrivateProduct: ProductRecord = {
        ...source,
        visibility: "private",
        updatedAt: new Date().toISOString(),
      };

      await store().writeRecord(pendingDestinationProduct);
      invalidateOrganizationDashboardDataCache();

      for (const installation of installations) {
        const reference = installation.sharedProductRef;
        if (
          !reference ||
          !refersToSharedProduct(installation, source) ||
          (destinationAdopterInstallation &&
            installation.productRecordId === destinationProductRecordId &&
            installation.organizationId === destinationOrganizationId)
        ) {
          continue;
        }
        await persistRecord(
          {
            ...installation,
            sharedProductRef: {
              ...reference,
              sourceOrganizationId: destinationOrganizationId as OrganizationId,
              sourceProductRecordId: destinationProductRecordId,
              sourceProductId: source.productId,
            },
            updatedAt: new Date().toISOString(),
          },
          "product.shared-installation-repointed",
          { kind: "subject", subjectId: actorId },
        );
      }

      await persistRecord(
        sourcePrivateProduct,
        "product.transferred-from",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          destinationOrganizationId,
          destinationProductRecordId,
          productName: source.name,
        },
      );
      const sourceClients = (await listRecordsWithRecovery("consumer-client"))
        .map((entry) => entry.record)
        .filter(
          (client) =>
            client.organizationId === source.organizationId &&
            client.productId === source.productId,
        );
      for (const client of sourceClients) {
        await persistRecord(
          {
            ...client,
            organizationId: destinationOrganizationId as OrganizationId,
            updatedAt: new Date().toISOString(),
          },
          "consumer-client.publisher-transferred",
          { kind: "subject", subjectId: actorId },
          {
            sourceOrganizationId: source.organizationId,
            destinationOrganizationId,
            productId: source.productId,
          },
        );
      }
      await store().writeRecord(destinationProduct);
      invalidateOrganizationDashboardDataCache();
      await appendRecordActivityEvent(
        sourcePrivateProduct,
        "product.transferred",
        { kind: "subject", subjectId: actorId },
        {
          organizationId: destinationOrganizationId,
          sourceOrganizationId: source.organizationId,
          destinationOrganizationId,
          destinationProductRecordId,
          productName: source.name,
        },
      );

      return {
        product: destinationProduct,
        sourceOrganizationId: source.organizationId,
        destinationOrganizationId,
        affectedOrganizationIds: [
          ...new Set([
            source.organizationId,
            destinationOrganizationId,
            ...installations.map((installation) => installation.organizationId),
          ]),
        ],
      };
    });
  });
}

export async function transferPublicProductForAdministrator(
  actorId: SubjectId,
  productRecordId: string,
  destinationOrganizationId: string,
): Promise<PublicProductTransferResult> {
  return transferPublicProduct(
    actorId,
    productRecordId,
    destinationOrganizationId,
    "administrator",
  );
}

export async function transferPublicProductForOrganizationOwner(
  actorId: SubjectId,
  sourceOrganizationId: string,
  productRecordId: string,
  destinationOrganizationId: string,
): Promise<PublicProductTransferResult> {
  return transferPublicProduct(
    actorId,
    productRecordId,
    destinationOrganizationId,
    "organization-owner",
    sourceOrganizationId,
  );
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
      if (visibility === "public" && (await hasAnotherPublicPublisherUnlocked(current.record))) {
        throw new Error("Another organization already publishes a product with this product ID.");
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

export const getOrganizationDashboardData = cache(async function getOrganizationDashboardData(
  subjectId: SubjectId,
  organizationId: string,
): Promise<OrganizationDashboardData> {
  return authMutationQueue.read(async () => {
    assertOpaqueId(organizationId);
    const cached = getCachedOrganizationDashboardData(subjectId, organizationId);
    if (cached) {
      const [organizationRecord, catalogMembershipRecord] = await Promise.all([
        loadRecord("organization", organizationId),
        store().readOrganizationMembership(organizationId, subjectId),
      ]);
      const organization = organizationRecord?.record;
      if (!organization || organizationApprovalStatus(organization) !== "approved") {
        throw new Error("Organization not found.");
      }
      const catalogMembership =
        catalogMembershipRecord?.status === "active" ? catalogMembershipRecord : null;
      const productMembership = cached.memberships.find(
        (membership) =>
          membership.organizationId === organizationId &&
          !!membership.productId &&
          membership.status === "active",
      );
      if (!catalogMembership && !productMembership) throw new Error("Organization not found.");
      const currentMembership = catalogMembership ?? {
        ...productMembership!,
        role: "member" as const,
        productId: undefined,
        permissionGrants: undefined,
      };
      const organizationSummary = {
        organization,
        membership: currentMembership,
        catalogManager: !!catalogMembership,
      } satisfies OrganizationSummary;
      const data: OrganizationDashboardData = {
        ...cached.data,
        organization: organizationSummary,
        organizations: cached.data.organizations.map((summary) =>
          summary.organization.organizationId === organizationId ? organizationSummary : summary,
        ),
      };
      return data;
    }

    const [organizationRecord, catalogMembershipRecord, memberships, allProducts] =
      await Promise.all([
        loadRecord("organization", organizationId),
        store().readOrganizationMembership(organizationId, subjectId),
        store().listMembershipsForSubject(subjectId),
        store().listProducts(organizationId),
      ]);
    const organization = organizationRecord?.record;
    if (!organization || organizationApprovalStatus(organization) !== "approved") {
      throw new Error("Organization not found.");
    }

    const catalogMembership =
      catalogMembershipRecord?.status === "active" ? catalogMembershipRecord : null;
    const activeMemberships = memberships.filter((membership) => membership.status === "active");
    const productMembership = activeMemberships.find(
      (membership) => membership.organizationId === organizationId && !!membership.productId,
    );
    if (!catalogMembership && !productMembership) throw new Error("Organization not found.");
    const currentMembership = catalogMembership ?? {
      ...productMembership!,
      role: "member" as const,
      productId: undefined,
      permissionGrants: undefined,
    };

    const membershipsByOrganization = new Map<string, OrganizationMembershipRecord[]>();
    for (const membership of activeMemberships) {
      const entries = membershipsByOrganization.get(membership.organizationId) ?? [];
      entries.push(membership);
      membershipsByOrganization.set(membership.organizationId, entries);
    }
    const organizationSummaries = await mapWithConcurrency<
      [string, OrganizationMembershipRecord[]],
      OrganizationSummary | null
    >([...membershipsByOrganization.entries()], async ([memberOrganizationId, entries]) => {
      const record =
        memberOrganizationId === organizationId
          ? organizationRecord
          : await loadRecord("organization", memberOrganizationId);
      if (!record || organizationApprovalStatus(record.record) !== "approved") return null;
      const organizationCatalogMembership = entries.find((membership) => !membership.productId);
      const organizationProductMembership = entries.find((membership) => !!membership.productId);
      if (organizationCatalogMembership) {
        return {
          organization: record.record,
          membership: organizationCatalogMembership,
          catalogManager: true,
        } satisfies OrganizationSummary;
      }
      if (!organizationProductMembership) return null;
      return {
        organization: record.record,
        membership: {
          ...organizationProductMembership,
          role: "member",
          productId: undefined,
          permissionGrants: undefined,
        },
        catalogManager: false,
      } satisfies OrganizationSummary;
    });

    const allowedProductIds = new Set(
      activeMemberships
        .filter(
          (membership) => membership.organizationId === organizationId && membership.productId,
        )
        .map((membership) => membership.productId!),
    );
    if (!catalogMembership && allowedProductIds.size === 0) {
      throw new Error("Organization not found.");
    }
    const data: OrganizationDashboardData = {
      organization: {
        organization,
        membership: currentMembership,
        catalogManager: !!catalogMembership,
      },
      organizations: organizationSummaries
        .filter((summary): summary is OrganizationSummary => summary !== null)
        .sort((left, right) => left.organization.name.localeCompare(right.organization.name)),
      products: allProducts
        .filter((product) => !!catalogMembership || allowedProductIds.has(product.productId))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
    setCachedOrganizationDashboardData(subjectId, organizationId, data, memberships);
    return data;
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
  const [actor, organization, product, membership] = await Promise.all([
    loadSubjectUnlocked(actorId),
    loadApprovedOrganizationUnlocked(organizationId),
    store().readProduct(organizationId, productId),
    store().readOrganizationMembership(organizationId, actorId, productId),
  ]);
  requireVerifiedActiveSubject(actor);
  if (!organization || !product) throw new Error("Product not found.");
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

async function consumerClientPublisherProductUnlocked(
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
  const reference = product.sharedProductRef;
  if (!reference) return product;

  const publisher = await store().readProduct(
    reference.sourceOrganizationId,
    reference.sourceProductId,
  );
  if (
    !publisher ||
    publisher.sharedProductRef ||
    publisher.productRecordId !== reference.sourceProductRecordId ||
    publisher.productId !== productId ||
    publisher.visibility !== "public"
  ) {
    throw new Error("The product publisher is unavailable.");
  }
  return publisher;
}

async function consumerClientOrganizationsForPublisherUnlocked(
  publisher: ProductRecord,
): Promise<Set<string>> {
  const organizationIds = new Set<string>([publisher.organizationId]);
  if (!isSharedProductSource(publisher)) return organizationIds;

  const products = (await listRecordsWithRecovery("product")).map((entry) => entry.record);
  for (const product of products) {
    if (isActiveSharedInstallationForSource(product, publisher)) {
      organizationIds.add(product.organizationId);
    }
  }
  return organizationIds;
}

async function requireManagedConsumerClientUnlocked(
  organizationId: string,
  productId: string,
  clientId: string,
  requireActive: boolean,
  errorMessage: string,
): Promise<VersionedRecord<ConsumerClientRecord>> {
  const found = await loadRecord("consumer-client", clientId);
  const publisher = await consumerClientPublisherProductUnlocked(organizationId, productId);
  const manageableOrganizations = await consumerClientOrganizationsForPublisherUnlocked(publisher);
  if (
    !found ||
    found.record.productId !== productId ||
    (requireActive && found.record.status !== "active") ||
    !found.record.organizationId ||
    !manageableOrganizations.has(found.record.organizationId)
  ) {
    throw new Error(errorMessage);
  }
  return found;
}

async function requirePublisherManagedConsumerClientProductUnlocked(
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
  if (product.sharedProductRef) {
    throw new Error("App clients are managed by the product publisher.");
  }
  return product;
}

function validateConsumerClientOptions(productId: string, options: CreateConsumerClientOptions) {
  const appName = options.appName.trim().replace(/\s+/g, " ");
  if (!appName || appName.length > 80 || /[\u0000-\u001f\u007f]/.test(appName)) {
    throw new Error("Enter an application name up to 80 characters.");
  }
  let appOrigin: string | null = null;
  const enteredAppOrigin = options.appOrigin.trim();
  if (enteredAppOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(enteredAppOrigin);
    } catch {
      throw new Error("Enter a valid app origin.");
    }
    const isAllowedProtocol =
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
    if (
      !isAllowedProtocol ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        "Use an HTTPS app origin, or an HTTP localhost or 127.0.0.1 origin, without a path, query, or fragment. A portless http://localhost origin allows any localhost port.",
      );
    }
    const rawAuthority = enteredAppOrigin.match(/^http:\/\/([^/?#\\]*)/i)?.[1];
    const explicitPort = rawAuthority?.match(/:(\d+)$/)?.[1];
    const explicitLocalhostPort80 =
      parsed.protocol === "http:" &&
      parsed.hostname === "localhost" &&
      explicitPort !== undefined &&
      Number(explicitPort) === 80;
    appOrigin = explicitLocalhostPort80 ? "http://localhost:80" : parsed.origin;
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
    const publisher = await consumerClientPublisherProductUnlocked(
      organizationId,
      normalizedProductId,
    );
    const manageableOrganizations =
      await consumerClientOrganizationsForPublisherUnlocked(publisher);
    return (await listRecordsWithRecovery("consumer-client"))
      .map((item) => item.record)
      .filter(
        (record) =>
          record.productId === normalizedProductId &&
          !!record.organizationId &&
          manageableOrganizations.has(record.organizationId),
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
      await requirePublisherManagedConsumerClientProductUnlocked(
        organizationId,
        normalizedProductId,
      );
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

export async function updateConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
  options: CreateConsumerClientOptions,
): Promise<ConsumerClientSummary> {
  assertOpaqueId(clientId);
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const validated = validateConsumerClientOptions(normalizedProductId, options);
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        true,
        "Choose an active application client for this product.",
      );
      const next: ConsumerClientRecord = {
        ...found.record,
        appName: validated.appName,
        appOrigin: validated.appOrigin,
        sessionLifetimeMs: options.sessionLifetimeSeconds * 1000,
        selfRegistrationEnabled: options.selfRegistrationEnabled,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "consumer-client.updated", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return consumerClientSummary(next);
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
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        true,
        "Choose an active application client for this product.",
      );
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
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        false,
        "Application client not found.",
      );
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
  options: { includeDisabled?: boolean } = {},
): Promise<ProductMemberView[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner", "admin"]);
    const memberships = (await store().listOrganizationMemberships(organizationId))
      .filter(
        (record) =>
          record.productId === productId && (options.includeDisabled || record.status === "active"),
      )
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

type ProductMemberMutationContext = Awaited<
  ReturnType<typeof productMemberMutationContextUnlocked>
>;

async function withProductMemberMutation<Result>(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
  operation: (context: ProductMemberMutationContext) => Promise<Result>,
): Promise<Result> {
  assertOpaqueId(subjectId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () =>
      operation(
        await productMemberMutationContextUnlocked(
          actorId,
          organizationId,
          productId,
          subjectId as SubjectId,
        ),
      ),
    ),
  );
}

export async function updateProductMemberRole(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
  role: OrganizationRole,
): Promise<void> {
  return withProductMemberMutation(
    actorId,
    organizationId,
    productId,
    subjectId,
    async ({ owner, current }) => {
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
        { changes: [{ field: "role", before: current.role, after: role }] },
      );
    },
  );
}

export async function removeProductMember(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  subjectId: string,
): Promise<void> {
  return withProductMemberMutation(
    actorId,
    organizationId,
    productId,
    subjectId,
    async ({ owner, current }) => {
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
    },
  );
}

export interface ConsumerMemberScopeInput {
  organizationId: string;
  productId: string;
  scopeKind: "workspace" | "project";
  resourceId: string;
}

type ConsumerResourceScope = Extract<ResourceScope, { kind: "workspace" | "project" }>;

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
): ConsumerResourceScope {
  const normalizedProductId = validateProductId(authenticatedProductId);
  if (validateProductId(input.productId) !== normalizedProductId) {
    throw new Error("This application does not manage that product.");
  }
  if (!consumerProductPolicy(normalizedProductId)) {
    throw new Error("This application does not manage that resource type.");
  }
  const scope = validateScope(
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
  if (scope.kind === "product") {
    throw new Error("Choose a workspace or project.");
  }
  return scope;
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
  if (!policy || !(await loadApprovedOrganizationUnlocked(scope.organizationId))) {
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
  await persistRecord(
    membership,
    "product.member-added",
    {
      kind: "subject",
      subjectId: subject.subjectId,
    },
    {
      changes: [{ field: "role", before: "None", after: membership.role }],
    },
  );
  return membership;
}

async function setConsumerMemberRoleUnlocked(
  actorId: SubjectId,
  authenticatedProductId: string,
  subjectId: SubjectId,
  scope: ConsumerResourceScope,
  role: string,
  existing?: MembershipRecord,
): Promise<MembershipRecord> {
  const actions = consumerRoleActions(authenticatedProductId, role, scope.kind);
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
  await persistRecord(
    grant,
    "consumer.member-role-updated",
    { kind: "subject", subjectId: actorId },
    {
      changes: [
        {
          field: "role",
          before: existing?.accessRole?.name ?? "None",
          after: grant.accessRole?.name ?? role,
        },
      ],
    },
  );
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

type WorkspaceManagementContext = {
  organizationId: string;
  workspaceId: string;
  productId: string;
  scope: ReturnType<typeof validateScope>;
};

async function withWorkspaceManagement<T>(
  actorId: SubjectId,
  productIdInput: string,
  organizationIdInput: string,
  workspaceIdInput: string,
  operation: (context: WorkspaceManagementContext) => Promise<T>,
): Promise<T> {
  const productId = validateProductId(productIdInput);
  const organizationId = organizationIdInput.trim().toLowerCase();
  const workspaceId = workspaceIdInput.trim().toLowerCase();
  assertOpaqueId(organizationId);
  assertOpaqueId(workspaceId);
  const scope = validateScope({
    kind: "workspace",
    organizationId: organizationId as OrganizationId,
    productId,
    workspaceId,
  });

  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
      await requireOrganizationProductUnlocked(organizationId, productId);
      return operation({ organizationId, workspaceId, productId, scope });
    }),
  );
}

export async function bootstrapWorkspaceAdmin(
  actorId: SubjectId,
  productId: string,
  organizationIdInput: string,
  workspaceIdInput: string,
): Promise<void> {
  await withWorkspaceManagement(
    actorId,
    productId,
    organizationIdInput,
    workspaceIdInput,
    async ({ organizationId, productId, scope }) => {
      const actor = await loadSubjectUnlocked(actorId);
      requireVerifiedActiveSubject(actor);
      if (consumerProductState(actor, productId).status !== "active") {
        throw new Error("This account is disabled for the application.");
      }

      const existingMembership = await store().readOrganizationMembership(
        organizationId,
        actorId,
        productId,
      );
      if (existingMembership?.status === "disabled") {
        throw new Error("This account is disabled for the application.");
      }
      const membership =
        existingMembership ??
        (await ensureConsumerProductMembershipUnlocked(actor, organizationId, productId));
      const actions = consumerRoleActions(productId, "admin", "workspace");
      if (!actions) throw new Error("Workspace administration is unavailable.");
      const currentGrant = consumerMemberGrant(membership, scope);
      const grant = roleGrant(
        productId,
        actorId,
        scope,
        "admin",
        actions,
        currentGrant ?? undefined,
      );
      await persistRecord(grant, "consumer.workspace-admin-bootstrapped", {
        kind: "subject",
        subjectId: actorId,
      });
    },
  );
}

export async function revokeWorkspaceGrants(
  actorId: SubjectId,
  productId: string,
  organizationIdInput: string,
  workspaceIdInput: string,
): Promise<void> {
  await withWorkspaceManagement(
    actorId,
    productId,
    organizationIdInput,
    workspaceIdInput,
    async ({ organizationId, productId, scope }) => {
      const memberships = await store().listOrganizationMemberships(organizationId);
      for (const membership of memberships) {
        if (membership.productId !== productId) continue;
        for (const grant of membership.permissionGrants ?? []) {
          if (!sameResourceScope(grant.scope, scope) || grant.status !== "active") continue;
          await persistRecord(
            { ...grant, status: "disabled", updatedAt: new Date().toISOString() },
            "consumer.workspace-access-revoked",
            { kind: "subject", subjectId: actorId },
          );
        }
      }
    },
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

async function protectLastWorkspaceAdminUnlocked(
  targetId: SubjectId,
  scope: ResourceScope,
  currentGrant: MembershipRecord,
  nextRole: string | null,
  nextStatus: "active" | "disabled",
): Promise<void> {
  if (
    scope.kind !== "workspace" ||
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
  if (!consumerRoleActions(authenticatedProductId, input.role, scope.kind)) {
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
        if (username && !platformAdmin) {
          throw new Error("A platform administrator must assign the account username.");
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
        if (!alreadyLinked && !platformAdmin) {
          throw new Error("A platform administrator must assign a new username.");
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
        actorMembership.subjectId,
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
  if (
    input.role !== undefined &&
    !consumerRoleActions(authenticatedProductId, input.role, scope.kind)
  ) {
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
      if (actorId === subjectId && !platformAdmin) {
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
      await protectLastWorkspaceAdminUnlocked(subjectId, scope, currentGrant, nextRole, nextStatus);
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
          actorId,
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
    const organizationMemberships = await store().listOrganizationMemberships(organizationId);
    const membershipsBySubject = new Map(
      organizationMemberships
        .filter((membership) => membership.productId === productId)
        .map((membership) => [membership.subjectId, membership]),
    );
    const result: ConsumerAccountView[] = [];
    for (const subject of subjects) {
      const username = usernameForProduct(subject, productId);
      const membership = membershipsBySubject.get(subject.subjectId);
      if (!username || !membership) continue;
      result.push({
        subjectId: subject.subjectId,
        email: subject.primaryEmail,
        username,
        status: consumerProductState(subject, productId).status,
        platformAdmin: hasConsumerPlatformPermission(membership, policy.accountManagementAction),
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
  if (!policy?.accountManagementAction) {
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
      const organizationMembership = await store().readOrganizationMembership(
        input.organizationId,
        subjectIdInput as SubjectId,
        input.productId,
      );
      if (!current || !usernameForProduct(current, input.productId) || !organizationMembership) {
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

export interface LegacyAuthImportProduct {
  productId: string;
  organizationId: string;
  hashFormat: "argon2id-phc" | "legacy-scrypt-salt-hex-v1";
  users: Array<{
    accountId: string;
    username?: string;
    email?: string;
    passwordHash: string;
    platformAdmin?: boolean;
    disabled?: boolean;
  }>;
  memberships: Array<{
    accountId: string;
    scopeKind: "workspace" | "project";
    resourceId: string;
    role: string | null;
    active?: boolean;
  }>;
}

export interface LegacyAuthImportInput {
  products: LegacyAuthImportProduct[];
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
  source: string;
  accountId: string;
  sourceRef: string;
  email: string | null;
  username: string | null;
  credential: PasswordCredential;
  disabled: boolean;
  platformAdmin: boolean;
}

function importedCredential(
  format: LegacyAuthImportProduct["hashFormat"],
  encodedVerifier: string,
): PasswordCredential {
  if (format === "argon2id-phc") {
    if (!/^\$argon2id\$v=\d+\$/.test(encodedVerifier)) {
      throw new Error("Password hash does not match the configured Argon2id format.");
    }
    return {
      algorithm: "argon2id",
      format: "argon2id-phc",
      encodedVerifier,
      updatedAt: new Date().toISOString(),
    };
  }
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(encodedVerifier)) {
    throw new Error("Password hash does not match the configured salted scrypt format.");
  }
  return {
    algorithm: "scrypt",
    format: "legacy-scrypt-salt-hex-v1",
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

function legacyIdentityKey(
  productId: string,
  email: string | null,
  username: string | null,
): string {
  if (email) return "email:" + email;
  return "username:" + productId + ":" + (username ?? "");
}

function legacySourceRef(source: string, accountId: string): string {
  return source + ":" + accountId;
}

export async function importLegacyAuthData(
  input: LegacyAuthImportInput,
  dryRun: boolean,
): Promise<LegacyAuthImportReport> {
  return authMutationQueue.run(async () => {
    const report: LegacyAuthImportReport = {
      dryRun,
      applied: false,
      identities: 0,
      memberships: 0,
      conflicts: [],
      errors: [],
    };
    if (input.products.length === 0) report.errors.push("Add at least one product to the import.");
    const groups = new Map<string, LegacyIdentityCandidate[]>();
    const referenceToKey = new Map<string, string>();
    const seenSourceRefs = new Set<string>();
    const products: Array<LegacyAuthImportProduct & { productId: string; organizationId: string }> =
      [];
    const memberships: Array<{
      productId: string;
      organizationId: string;
      accountId: string;
      scopeKind: "workspace" | "project";
      resourceId: string;
      role: string | null;
      active?: boolean;
    }> = [];

    const addCandidate = (candidate: LegacyIdentityCandidate) => {
      const key = legacyIdentityKey(candidate.source, candidate.email, candidate.username);
      const group = groups.get(key) ?? [];
      if (seenSourceRefs.has(candidate.sourceRef)) {
        report.errors.push("Duplicate account reference: " + candidate.sourceRef);
        return;
      }
      seenSourceRefs.add(candidate.sourceRef);
      group.push(candidate);
      groups.set(key, group);
      referenceToKey.set(candidate.sourceRef, key);
    };

    const seenProducts = new Set<string>();
    for (const inputProduct of input.products) {
      let productId: string;
      try {
        productId = validateProductId(inputProduct.productId);
      } catch (error) {
        report.errors.push(error instanceof Error ? error.message : "Invalid product ID.");
        continue;
      }
      const organizationId = inputProduct.organizationId.trim().toLowerCase();
      if (seenProducts.has(productId)) {
        report.errors.push("Product appears more than once in the import: " + productId);
        continue;
      }
      seenProducts.add(productId);
      const product = { ...inputProduct, productId, organizationId };
      products.push(product);

      if (!(await loadApprovedOrganizationUnlocked(organizationId))) {
        report.errors.push(
          "Organization was not found or is not approved for product " + productId + ".",
        );
      } else if (!(await store().readProduct(organizationId, productId))) {
        report.errors.push(
          "Product was not found in its configured organization: " + productId + ".",
        );
      }

      for (const account of product.users) {
        try {
          const accountId = account.accountId.trim();
          if (!accountId || accountId.length > 254) throw new Error("Invalid account ID.");
          const username = account.username ? normalizeProductUsername(account.username) : null;
          const email = account.email
            ? canonicalEmail(account.email)
            : username?.includes("@")
              ? canonicalEmail(username)
              : null;
          if (!email && !username) throw new Error("Provide an email address or username.");
          const sourceRef = legacySourceRef(productId, accountId);
          addCandidate({
            source: productId,
            accountId,
            sourceRef,
            email,
            username,
            credential: importedCredential(product.hashFormat, account.passwordHash),
            disabled: !!account.disabled,
            platformAdmin: !!account.platformAdmin,
          });
        } catch (error) {
          report.errors.push(
            "Invalid account for product " +
              productId +
              ": " +
              (error instanceof Error ? error.message : "account data is invalid."),
          );
        }
      }

      for (const membership of product.memberships) {
        const accountId = membership.accountId.trim();
        const sourceRef = legacySourceRef(productId, accountId);
        if (!referenceToKey.has(sourceRef)) {
          report.errors.push(
            "Membership refers to an unknown account for product " + productId + ": " + accountId,
          );
        }
        try {
          consumerResourceScope(productId, {
            organizationId,
            productId,
            scopeKind: membership.scopeKind,
            resourceId: membership.resourceId,
          });
          if (
            membership.role !== null &&
            !consumerRoleActions(productId, membership.role, membership.scopeKind)
          ) {
            throw new Error("Choose a role supported by this application.");
          }
          memberships.push({
            productId,
            organizationId,
            accountId,
            scopeKind: membership.scopeKind,
            resourceId: membership.resourceId,
            role: membership.role,
            active: membership.active,
          });
        } catch {
          report.errors.push(
            "Invalid " +
              membership.scopeKind +
              " membership for product " +
              productId +
              ": " +
              membership.resourceId,
          );
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
      for (const candidate of candidates.filter((item) => item.username)) {
        const byUsername = await loadSubjectByUsernameUnlocked(
          candidate.source,
          candidate.username!,
        );
        if (subject && byUsername && subject.subjectId !== byUsername.subjectId) {
          report.errors.push("Identity mapping conflict for " + key + ".");
        } else if (byUsername) {
          subject = byUsername;
        }
      }
      if (subject?.primaryEmail && email && subject.primaryEmail.toLowerCase() !== email) {
        report.errors.push("Email conflict for " + key + ".");
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
          sourceRef: "perminister:" + subject.subjectId,
          credential: subject.passwordCredential,
        });
      }
      const distinct = new Map(
        credentialOptions.map((option) => [
          option.credential.algorithm + ":" + option.credential.encodedVerifier,
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
        report.errors.push("No usable password credential was found for " + key + ".");
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
    report.memberships = memberships.length;
    if (dryRun || report.errors.length > 0 || report.conflicts.length > 0) return report;

    const subjectByKey = new Map<string, SubjectRecord>();
    for (const [key, item] of prepared) {
      const now = new Date().toISOString();
      const sourceMap = new Map<string, LegacyIdentitySource>();
      for (const source of item.subject?.legacySources ?? []) {
        sourceMap.set(legacySourceRef(source.source, source.accountId), source);
      }
      for (const candidate of item.candidates) {
        sourceMap.set(candidate.sourceRef, {
          source: candidate.source,
          accountId: candidate.accountId,
        });
      }
      const legacySources = [...sourceMap.values()];
      const email =
        item.candidates.find((candidate) => candidate.email)?.email ??
        item.subject?.primaryEmail ??
        null;
      let consumerProductStates = item.subject?.consumerProductStates ?? [];
      for (const productId of new Set(item.candidates.map((candidate) => candidate.source))) {
        const previous = consumerProductStates.find((state) => state.productId === productId);
        const disabled = item.candidates.some(
          (candidate) => candidate.source === productId && candidate.disabled,
        );
        const status = disabled ? "disabled" : "active";
        const productState: ConsumerProductState = {
          productId,
          status,
          sessionVersion:
            (previous?.sessionVersion ?? 1) + ((previous?.status ?? "active") !== status ? 1 : 0),
        };
        consumerProductStates = [
          ...consumerProductStates.filter((state) => state.productId !== productId),
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
        if (!candidate.username) continue;
        const existing = identifiers.find(
          (identifier) =>
            identifier.productId === candidate.source &&
            identifier.normalizedValue === candidate.username,
        );
        if (existing) continue;
        const existingSubjectId = await store().findSubjectIdByUsername(
          candidate.source,
          candidate.username,
        );
        if (existingSubjectId && existingSubjectId !== subject.subjectId) {
          throw new Error("Username collision for product " + candidate.source + ".");
        }
        identifiers.push({
          kind: "username",
          productId: candidate.source,
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

    for (const product of products) {
      const policy = consumerProductPolicy(product.productId);
      for (const user of product.users) {
        if (!user.platformAdmin) continue;
        const accountId = user.accountId.trim();
        const key = referenceToKey.get(legacySourceRef(product.productId, accountId));
        const subject = key ? subjectByKey.get(key) : undefined;
        if (!subject) continue;
        const productScope: ResourceScope = {
          kind: "product",
          organizationId: product.organizationId as OrganizationId,
          productId: product.productId,
        };
        await upsertImportedRoleGrantUnlocked(
          product.productId,
          subject,
          productScope,
          "platform-admin",
          policy?.platformAdminActions ?? [],
        );
      }
    }

    for (const membership of memberships) {
      if (!membership.role) continue;
      const key = referenceToKey.get(legacySourceRef(membership.productId, membership.accountId));
      const subject = key ? subjectByKey.get(key) : undefined;
      if (!subject) continue;
      const scope = consumerResourceScope(membership.productId, {
        organizationId: membership.organizationId,
        productId: membership.productId,
        scopeKind: membership.scopeKind,
        resourceId: membership.resourceId,
      });
      const actions = consumerRoleActions(
        membership.productId,
        membership.role,
        membership.scopeKind,
      );
      if (!actions) continue;
      await upsertImportedRoleGrantUnlocked(
        membership.productId,
        subject,
        scope,
        membership.role,
        actions,
        membership.active === false ? "disabled" : "active",
      );
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
      await persistRecord(
        invitation,
        "organization.invitation-created",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
        },
      );
      return { invitation, token, organizationName: organization.record.name };
    }),
  );
}

export async function prepareOrganizationInvitationResend(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
): Promise<{ invitation: OrganizationInvitationRecord; token: string; organizationName: string }> {
  assertOpaqueId(invitationId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (
        !current ||
        current.record.organizationId !== organizationId ||
        current.record.productId ||
        current.record.consumedAt ||
        current.record.revokedAt ||
        Date.parse(current.record.expiresAt) <= Date.now()
      ) {
        throw new Error("Invitation not found.");
      }

      const organization = await loadRecord("organization", organizationId);
      if (!organization) throw new Error("Organization not found.");
      const target = await loadSubjectByEmailUnlocked(current.record.email);
      if (target && (await organizationMembershipUnlocked(organizationId, target.subjectId))) {
        throw new Error("This person is already a catalog manager.");
      }

      const { invitation, token } = createInvitationDraft(
        actorMembership.subjectId,
        organizationId,
        current.record.email,
        current.record.role,
      );
      await persistRecord(
        invitation,
        "organization.invitation-created",
        { kind: "subject", subjectId: actorMembership.subjectId },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
          resendOfInvitationId: current.record.invitationId,
        },
      );
      return { invitation, token, organizationName: organization.record.name };
    }),
  );
}

export async function completeOrganizationInvitationResend(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
  resentInvitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  assertOpaqueId(resentInvitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
      ]);
      const resent = await loadRecord("organization-invitation", resentInvitationId);
      const previous = await loadRecord("organization-invitation", invitationId);
      if (
        !resent ||
        resent.record.organizationId !== organizationId ||
        resent.record.productId ||
        resent.record.createdBySubjectId !== actorMembership.subjectId ||
        resent.record.consumedAt ||
        resent.record.revokedAt ||
        Date.parse(resent.record.expiresAt) <= Date.now()
      ) {
        throw new Error("Invitation not found.");
      }
      if (
        !previous ||
        previous.record.organizationId !== organizationId ||
        previous.record.productId ||
        previous.record.email !== resent.record.email
      ) {
        throw new Error("Invitation not found.");
      }

      const invites = (await listRecordsWithRecovery("organization-invitation")).map(
        (item) => item.record,
      );
      for (const previous of invites.filter(
        (item) =>
          item.organizationId === organizationId &&
          !item.productId &&
          item.email === resent.record.email &&
          item.invitationId !== resentInvitationId &&
          !item.consumedAt &&
          !item.revokedAt,
      )) {
        await persistRecord(
          { ...previous, revokedAt: new Date().toISOString() },
          "organization.invitation-replaced",
          { kind: "subject", subjectId: actorMembership.subjectId },
        );
      }
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
      await persistRecord(
        invitation,
        "product.invitation-created",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
        },
      );
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
): Promise<PlatformAuditPage> {
  return authMutationQueue.read(async () => {
    await requireAdministrator(actorId);
    const activityStore = store();
    const events = (
      typeof activityStore.listRecentEvents === "function"
        ? await activityStore.listRecentEvents(PLATFORM_AUDIT_MAX_EVENTS)
        : await activityStore.listAllEvents()
    ).slice(0, PLATFORM_AUDIT_MAX_EVENTS);
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
    .filter((entry) => !entry.record.deletedAt)
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
    if (current.record.deletedAt) throw new Error("Account not found.");
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

export async function deleteAccountForAdministrator(
  actorId: SubjectId,
  subjectIdInput: string,
): Promise<void> {
  assertOpaqueId(subjectIdInput);
  await authMutationQueue.run(async () => {
    const actor = await requireAdministrator(actorId);
    if (subjectIdInput === actor.subjectId) throw new Error("You cannot delete your own account.");

    const initial = await loadRecord("subject", subjectIdInput);
    if (!initial) throw new Error("Account not found.");
    if (initial.record.deletedAt) return;
    if (initial.record.status !== "disabled")
      throw new Error("Disable the account before deleting it.");
    if (
      initial.record.primaryEmail &&
      configuredAdministrators().has(initial.record.primaryEmail.toLowerCase())
    ) {
      throw new Error(
        "Remove this address from PERMINISTER_ADMIN_EMAILS before deleting the account.",
      );
    }

    const initialMemberships = await store().listMembershipsForSubject(initial.record.subjectId);
    const initialKeys = await store().listApiKeysForSubject(initial.record.subjectId);
    const organizationIds = [
      ...new Set(
        [
          ...initialMemberships.map((membership) => membership.organizationId),
          ...initialKeys.map((key) => key.scope.organizationId),
        ].filter(Boolean),
      ),
    ].sort();

    const withOrganizationLocks = async (
      index: number,
      operation: () => Promise<void>,
    ): Promise<void> => {
      if (index >= organizationIds.length) return operation();
      return withOrganizationMutationLock(organizationIds[index], () =>
        withOrganizationLocks(index + 1, operation),
      );
    };

    await withOrganizationLocks(0, async () => {
      const current = await loadRecord("subject", subjectIdInput);
      if (!current) throw new Error("Account not found.");
      if (current.record.deletedAt) return;
      if (current.record.status !== "disabled") {
        throw new Error("Disable the account before deleting it.");
      }
      if (
        current.record.primaryEmail &&
        configuredAdministrators().has(current.record.primaryEmail.toLowerCase())
      ) {
        throw new Error(
          "Remove this address from PERMINISTER_ADMIN_EMAILS before deleting the account.",
        );
      }

      const memberships = (
        await store().listMembershipsForSubject(current.record.subjectId)
      ).filter((membership) => organizationIds.includes(membership.organizationId));
      for (const membership of memberships) {
        if (membership.status !== "active" || membership.role !== "owner") continue;
        const organizationMemberships = await store().listOrganizationMemberships(
          membership.organizationId,
        );
        let hasAnotherActiveOwner = false;
        for (const candidate of organizationMemberships) {
          if (
            candidate.subjectId === current.record.subjectId ||
            candidate.productId !== membership.productId ||
            candidate.role !== "owner" ||
            candidate.status !== "active"
          ) {
            continue;
          }
          const owner = await loadSubjectUnlocked(candidate.subjectId);
          if (owner?.status === "active" && isEmailVerifiedOrExempt(owner)) {
            hasAnotherActiveOwner = true;
            break;
          }
        }
        if (!hasAnotherActiveOwner) {
          throw new Error(
            "Transfer organization and product ownership to another active owner before deleting this account.",
          );
        }
      }

      const now = new Date().toISOString();
      for (const membership of memberships) {
        const permissionGrants = (membership.permissionGrants ?? []).map((grant) =>
          grant.status === "active"
            ? { ...grant, status: "disabled" as const, updatedAt: now }
            : grant,
        );
        if (
          membership.status === "disabled" &&
          permissionGrants.every(
            (grant, index) => grant === (membership.permissionGrants ?? [])[index],
          )
        ) {
          continue;
        }
        await persistRecord(
          {
            ...membership,
            status: "disabled",
            permissionGrants,
            updatedAt: now,
          },
          "identity.deleted-membership-revoked",
          { kind: "subject", subjectId: actor.subjectId },
        );
      }

      const keys = await store().listApiKeysForSubject(current.record.subjectId);
      for (const key of keys) {
        if (key.status !== "active") continue;
        await persistRecord(
          { ...key, status: "revoked", revokedAt: now },
          "identity.deleted-api-key-revoked",
          { kind: "subject", subjectId: actor.subjectId },
        );
      }

      await persistRecord(
        {
          ...current.record,
          status: "disabled",
          deletedAt: now,
          firstName: undefined,
          lastName: undefined,
          primaryEmail: null,
          emailVerifiedAt: null,
          emailVerificationExempt: false,
          loginIdentifiers: [],
          legacySources: [],
          legacyCredentialSource: undefined,
          consumerProductStates: [],
          passwordCredential: null,
          authVersion: current.record.authVersion + 1,
          updatedAt: now,
        },
        "identity.deleted",
        { kind: "subject", subjectId: actor.subjectId },
      );
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
      await persistRecord(
        membership,
        "permission.granted",
        {
          kind: "subject",
          subjectId: actorMembership.subjectId,
        },
        {
          ...(role ? { accessRoleName: role.name } : {}),
          changes: [{ field: "actions", before: [], after: [...actions] }],
        },
      );
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
        { changes: [{ field: "status", before: current.record.status, after: status }] },
      );
    });
  });
}

export async function deletePermissionGrant(
  actorId: SubjectId,
  membershipId: string,
): Promise<void> {
  assertOpaqueId(membershipId);
  await authMutationQueue.run(async () => {
    const initial = await loadRecord("membership", membershipId);
    if (!initial) throw new Error("Permission grant not found.");
    const { organizationId, productId } = initial.record.scope;

    await withOrganizationMutationLock(organizationId, async () => {
      const current = await loadRecord("membership", membershipId);
      if (
        !current ||
        current.record.scope.organizationId !== organizationId ||
        current.record.scope.productId !== productId
      ) {
        throw new Error("Permission grant not found.");
      }
      const actorMembership = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      if (current.record.status !== "disabled") {
        throw new Error("Only disabled permissions can be deleted.");
      }

      const productMembership = await store().readOrganizationMembership(
        organizationId,
        current.record.subjectId,
        productId,
      );
      const grants = productMembership?.permissionGrants ?? [];
      if (!productMembership || !grants.some((grant) => grant.membershipId === membershipId)) {
        throw new Error("Permission grant not found.");
      }

      await store().writeRecord({
        ...productMembership,
        permissionGrants: grants.filter((grant) => grant.membershipId !== membershipId),
        updatedAt: new Date().toISOString(),
      });
      invalidateOrganizationDashboardDataCache();
      await appendRecordActivityEvent(
        current.record,
        "permission.deleted",
        { kind: "subject", subjectId: actorMembership.subjectId },
        { changes: [{ field: "status", before: "disabled", after: "deleted" }] },
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

async function createApiKeyWithRotationUnlocked(
  owner: ApiKeyOwner,
  scope: ResourceScope,
  actions: readonly string[],
  expiresAt: string | null,
  previous: ApiKeyRecord | null,
  actorSubjectId: SubjectId,
  events: {
    created: string;
    rotatedCreated: string;
    revokedPrevious: string;
    rotationWarning: string;
  },
): Promise<CreatedApiKey> {
  const { record, token } = createApiKeyDraft(owner, scope, actions, expiresAt, previous);
  const actor = { kind: "subject" as const, subjectId: actorSubjectId };
  await persistRecord(record, previous ? events.rotatedCreated : events.created, actor, {
    keyClass: record.keyClass,
    expiresAt: record.expiresAt,
    changes: [{ field: "actions", before: [], after: [...record.actions] }],
  });
  let rotationWarning: string | null = null;
  if (previous) {
    try {
      await persistRecord(
        { ...previous, status: "revoked", revokedAt: new Date().toISOString() },
        events.revokedPrevious,
        actor,
      );
    } catch {
      rotationWarning = events.rotationWarning;
    }
  }
  return { record, token, rotationWarning };
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
      return createApiKeyWithRotationUnlocked(
        { kind: "service", servicePrincipalId: servicePrincipalId as ServicePrincipalId },
        scope,
        actions,
        options.expiresAt,
        previous,
        actor.subjectId,
        {
          created: "api-key.service-created",
          rotatedCreated: "api-key.service-rotated.created",
          revokedPrevious: "api-key.service-rotated.revoked-previous",
          rotationWarning:
            "The new key was created, but the previous key could not be revoked. Revoke it from the integration key list.",
        },
      );
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
      return createApiKeyWithRotationUnlocked(
        { kind: "subject", subjectId },
        scope,
        actions,
        options.expiresAt,
        previous,
        subjectId,
        {
          created: "api-key.created",
          rotatedCreated: "api-key.rotated.created",
          revokedPrevious: "api-key.rotated.revoked-previous",
          rotationWarning:
            "The new key was created, but the previous key could not be revoked. Revoke it from the key list.",
        },
      );
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
