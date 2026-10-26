import "server-only";

import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { verify as verifyArgon2id } from "@node-rs/argon2";
import { cache } from "react";
import { authMutationQueue } from "../mutation-queue";
import { mapWithConcurrency } from "../concurrency";
import {
  assertOpaqueId,
  authRecordId,
  newEventId,
  newSubjectId,
  type ApiKeyId,
  type ConsumerClientId,
  type ConsumerAuthorizationCodeId,
  type AuthActor,
  type AuthAggregate,
  type AuthEvent,
  type AuthRecord,
  type AuthRecordFor,
  type AuthRecordKind,
  type EmailActionId,
  type InvitationId,
  type ConsumerProductState,
  type MembershipId,
  type OrganizationId,
  type OrganizationApprovalStatus,
  type OrganizationMembershipId,
  type OrganizationMembershipRecord,
  type OrganizationRecord,
  type OrganizationRole,
  type PasswordCredential,
  type ProductRecord,
  type ProductRecordId,
  type ResourceScope,
  type SessionId,
  type SubjectId,
  type SubjectRecord,
  type ServicePrincipalId,
} from "../domain";
import { createSpacesAuthStoreFromEnv, type VersionedRecord } from "../storage/spaces";

const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_SUBJECT_CACHE_MAX_ENTRIES = 512;

export const sessionSubjectCache = new Map<string, SubjectId>();

let storeSingleton: ReturnType<typeof createSpacesAuthStoreFromEnv> | undefined;

export function store() {
  storeSingleton ??= createSpacesAuthStoreFromEnv();
  return storeSingleton;
}

export const listProductsByProductIdDuringRender = cache((productId: string) =>
  store().listProductsByProductId(validateProductId(productId)),
);

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

export function canonicalEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.includes("..")) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export function isEmailVerifiedOrExempt(subject: SubjectRecord): boolean {
  return (
    subject.primaryEmail === null || !!subject.emailVerifiedAt || !!subject.emailVerificationExempt
  );
}

export function consumerProductState(
  subject: SubjectRecord,
  productId: string,
): ConsumerProductState {
  return (
    subject.consumerProductStates?.find((state) => state.productId === productId) ?? {
      productId,
      status: "active",
      sessionVersion: 1,
    }
  );
}

export function updateConsumerProductState(
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

export function normalizedPersonName(
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

export function validatePassword(password: string): void {
  if (password.length < 15) {
    throw new Error("Use a password with at least 15 characters.");
  }
  if (password.length > 256) {
    throw new Error("Password must be 256 characters or fewer.");
  }
}

export function hashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function equalHex(expected: string, actual: string): boolean {
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

export async function createPasswordCredential(password: string): Promise<PasswordCredential> {
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

export async function createAdminProvisionedSubject(
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

export async function verifyPassword(
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

export async function loadRecord<Kind extends AuthRecordKind>(
  kind: Kind,
  id: string,
): Promise<VersionedRecord<AuthRecordFor<Kind>> | null> {
  return store().readRecord(kind, id);
}

export async function listRecordsWithRecovery<Kind extends AuthRecordKind>(
  kind: Kind,
): Promise<VersionedRecord<AuthRecordFor<Kind>>[]> {
  return store().listRecords(kind);
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

export async function persistRecord(
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

export async function appendRecordActivityEvent(
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

export async function loadSubjectByEmailUnlocked(email: string): Promise<SubjectRecord | null> {
  const subjectId = await store().findSubjectIdByEmail(email);
  return subjectId ? loadSubjectUnlocked(subjectId) : null;
}

export async function loadSubjectByUsernameUnlocked(
  productId: string,
  username: string,
): Promise<SubjectRecord | null> {
  const subjectId = await store().findSubjectIdByUsername(productId, username);
  return subjectId ? loadSubjectUnlocked(subjectId) : null;
}

export function normalizeProductUsername(value: string): string {
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

export async function rehashAfterLogin(
  subject: SubjectRecord,
  verifiedPassword: string,
): Promise<void> {
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

export async function loadSubjectUnlocked(subjectId: string): Promise<SubjectRecord | null> {
  const value = await loadRecord("subject", subjectId);
  return value && !value.record.deletedAt ? value.record : null;
}

export function mapMembershipsToSubjectContact<T extends { subjectId: string }>(memberships: T[]) {
  return mapWithConcurrency(memberships, async (membership) => {
    const subject = await loadSubjectUnlocked(membership.subjectId);
    return {
      membership,
      email: subject?.primaryEmail ?? null,
      emailVerified: !!subject?.emailVerifiedAt,
    };
  });
}

export function configuredAdministrators(): Set<string> {
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

export async function requireAdministrator(subjectId: SubjectId): Promise<SubjectRecord> {
  const actor = await loadSubjectUnlocked(subjectId);
  if (!actor || actor.status !== "active" || !isAdministrator(actor)) {
    throw new Error("Administrator access is required.");
  }
  return actor;
}

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

export function getCachedOrganizationDashboardData(
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

export function setCachedOrganizationDashboardData(
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

export function invalidateOrganizationDashboardDataCache(): void {
  organizationDashboardDataCache.clear();
}

export function rememberSessionSubject(sessionId: string, subjectId: SubjectId): void {
  sessionSubjectCache.delete(sessionId);
  sessionSubjectCache.set(sessionId, subjectId);
  if (sessionSubjectCache.size > SESSION_SUBJECT_CACHE_MAX_ENTRIES) {
    const oldestSessionId = sessionSubjectCache.keys().next().value;
    if (oldestSessionId !== undefined) sessionSubjectCache.delete(oldestSessionId);
  }
}

export function requireVerifiedActiveSubject(
  subject: SubjectRecord | null,
): asserts subject is SubjectRecord {
  if (!subject || subject.status !== "active" || !isEmailVerifiedOrExempt(subject)) {
    throw new Error("An active account with a verified email is required.");
  }
}

export function organizationName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80)
    throw new Error("Organization names must be 2 to 80 characters.");
  return name;
}

export function organizationApprovalStatus(
  organization: OrganizationRecord,
): OrganizationApprovalStatus {
  return organization.approvalStatus === undefined ? "approved" : organization.approvalStatus;
}

export async function loadApprovedOrganizationUnlocked(
  organizationId: string,
): Promise<OrganizationRecord | null> {
  const organization = await loadRecord("organization", organizationId);
  if (!organization || organizationApprovalStatus(organization.record) !== "approved") return null;
  return organization.record;
}

export async function organizationMembershipUnlocked(
  organizationId: string,
  subjectId: SubjectId,
): Promise<OrganizationMembershipRecord | null> {
  const membership = await store().readOrganizationMembership(organizationId, subjectId);
  return membership?.status === "active" ? membership : null;
}

export async function requireOrganizationRoleUnlocked(
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

export function validateProductId(value: string): string {
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

export function normalizeProductDetails(
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

export function validateScope(scope: ResourceScope): ResourceScope {
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

export function validateActions(actions: readonly string[]): string[] {
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

export async function requireOrganizationProductUnlocked(
  organizationId: string,
  productId: string,
): Promise<void> {
  if (!(await store().readProduct(organizationId, productId))) {
    throw new Error("Choose a product in this organization.");
  }
}

export function eventPayloadId(event: AuthEvent, key: string): string | null {
  const value = event.payload[key];
  if (typeof value !== "string") return null;
  try {
    assertOpaqueId(value);
    return value;
  } catch {
    return null;
  }
}
