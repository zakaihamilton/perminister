import "server-only";

import { createHmac } from "node:crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  ApiKeyRecord,
  AuthEvent,
  AuthRecord,
  AuthRecordFor,
  AuthRecordKind,
  EventId,
  OrganizationMembershipRecord,
  ProductRecord,
  SubjectId,
} from "../domain";
import { assertOpaqueId, authRecordId } from "../domain";
import { mapWithConcurrency } from "../concurrency";

const OBJECT_ROOT = "";
const OBJECT_PREFIX = OBJECT_ROOT ? `${OBJECT_ROOT}/` : "";
const INDEX_ROOT = `${OBJECT_PREFIX}indexes`;
const ID_INDEX_ROOT = `${INDEX_ROOT}/by-id`;

export interface VersionedRecord<RecordType extends AuthRecord = AuthRecord> {
  /** Compatibility shape for service callers; Spaces stores the record itself, not this envelope. */
  formatVersion: 1;
  revision: number;
  writtenAt: string;
  record: RecordType;
}

export interface SpacesAuthStoreOptions {
  client: S3Client;
  bucket: string;
  identityIndexSecret: string;
}

function assertNoPlaintextSecrets(value: unknown, path = "record"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaintextSecrets(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const isPlaintextCredentialField =
      normalizedKey.includes("secret") ||
      normalizedKey.includes("token") ||
      normalizedKey === "key" ||
      normalizedKey === "apikey" ||
      normalizedKey === "rawapikey" ||
      normalizedKey === "authorization" ||
      (normalizedKey.startsWith("password") && normalizedKey !== "passwordcredential");
    if (isPlaintextCredentialField) {
      throw new Error(`Refusing to persist plaintext credential field at ${path}.${key}`);
    }
    assertNoPlaintextSecrets(nested, `${path}.${key}`);
  }
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error("Invalid S3 key segment");
  }
  return value;
}

function recordKey(record: AuthRecord): string {
  switch (record.kind) {
    case "subject":
      return `${OBJECT_PREFIX}subjects/${record.subjectId}.json`;
    case "organization":
      return `${OBJECT_PREFIX}orgs/${record.organizationId}/organization.json`;
    case "organization-membership":
      return record.productId
        ? `${OBJECT_PREFIX}orgs/${record.organizationId}/products/${safeSegment(record.productId)}/members/${record.subjectId}.json`
        : `${OBJECT_PREFIX}orgs/${record.organizationId}/catalog-managers/${record.subjectId}.json`;
    case "product":
      return `${OBJECT_PREFIX}orgs/${record.organizationId}/products/${safeSegment(record.productId)}/product.json`;
    case "service-principal":
      return `${OBJECT_PREFIX}service-principals/${record.servicePrincipalId}.json`;
    case "organization-invitation":
      return record.productId
        ? `${OBJECT_PREFIX}orgs/${record.organizationId}/products/${safeSegment(record.productId)}/invitations/${record.invitationId}.json`
        : `${OBJECT_PREFIX}invitations/${record.invitationId}.json`;
    case "membership":
      return `${OBJECT_PREFIX}orgs/${record.scope.organizationId}/products/${safeSegment(record.scope.productId)}/members/${record.subjectId}/grants/${record.membershipId}.json`;
    case "api-key":
      return `${OBJECT_PREFIX}api-keys/${record.apiKeyId}.json`;
    case "consumer-client":
      return `${OBJECT_PREFIX}consumer-clients/${record.consumerClientId}.json`;
    case "consumer-authorization-code":
      return `${OBJECT_PREFIX}consumer-authorization-codes/${record.consumerAuthorizationCodeId}.json`;
    case "session":
      return `${OBJECT_PREFIX}sessions/${record.sessionId}.json`;
    case "email-action":
      return `${OBJECT_PREFIX}email-actions/${record.actionId}.json`;
  }
}

function identityIndexKey(kind: AuthRecordKind, id: string): string {
  assertOpaqueId(id);
  return `${ID_INDEX_ROOT}/${kind}/${id}.json`;
}

function eventIdentity(event: AuthEvent): string {
  return `${event.eventId}`;
}

function datePart(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Activity event has an invalid timestamp");
  return date.toISOString().slice(0, 10);
}

function eventKey(event: AuthEvent): string {
  return `${OBJECT_PREFIX}activity/events/${datePart(event.occurredAt)}/${event.occurredAt.replaceAll(":", "-")}-${eventIdentity(event)}.json`;
}

function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NoSuchKey" ||
    (candidate.name === "NotFound" && candidate.$metadata?.httpStatusCode === 404)
  );
}

function isAuthRecord(value: unknown, kind: AuthRecordKind, id?: string): value is AuthRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<AuthRecord>;
  if (record.schemaVersion !== 1 || record.kind !== kind) return false;
  if (id !== undefined) {
    try {
      return authRecordId(record as AuthRecord) === id;
    } catch {
      return false;
    }
  }
  return true;
}

function lowercaseScopeIdentifiers(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const scope = value as Record<string, unknown>;
  if (scope.kind !== "product" && scope.kind !== "project" && scope.kind !== "workspace") {
    return value;
  }
  const normalized: Record<string, unknown> = { ...scope };
  if (typeof scope.organizationId === "string")
    normalized.organizationId = scope.organizationId.toLowerCase();
  if (typeof scope.productId === "string") normalized.productId = scope.productId.toLowerCase();
  if (scope.kind === "project" && typeof scope.projectId === "string") {
    normalized.projectId = scope.projectId.toLowerCase();
  }
  if (scope.kind === "workspace" && typeof scope.workspaceId === "string") {
    normalized.workspaceId = scope.workspaceId.toLowerCase();
  }
  return normalized;
}

function lowercaseScopeIdentifiersInRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (record.kind === "membership" || record.kind === "api-key") {
    return { ...record, scope: lowercaseScopeIdentifiers(record.scope) };
  }
  if (record.kind === "organization-membership" && Array.isArray(record.permissionGrants)) {
    return {
      ...record,
      permissionGrants: record.permissionGrants.map((grant) => {
        if (typeof grant !== "object" || grant === null) return grant;
        const membership = grant as Record<string, unknown>;
        return { ...membership, scope: lowercaseScopeIdentifiers(membership.scope) };
      }),
    };
  }
  return value;
}

export class SpacesAuthStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly identityIndexSecret: string;

  constructor({ client, bucket, identityIndexSecret }: SpacesAuthStoreOptions) {
    if (!bucket.trim()) throw new Error("Spaces bucket is required");
    if (identityIndexSecret.length < 32) {
      throw new Error("Identity index secret must be at least 32 characters");
    }
    this.client = client;
    this.bucket = bucket;
    this.identityIndexSecret = identityIndexSecret;
  }

  async checkReadiness(): Promise<void> {
    await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: OBJECT_ROOT, MaxKeys: 1 }),
    );
  }

  async readRecord<Kind extends AuthRecordKind>(
    kind: Kind,
    id: string,
  ): Promise<VersionedRecord<AuthRecordFor<Kind>> | null> {
    assertOpaqueId(id);
    const directKey = this.directRecordKey(kind, id);
    const indexed = directKey
      ? null
      : await this.readJson<{ key?: unknown }>(identityIndexKey(kind, id));
    const key =
      directKey ??
      (typeof indexed?.key === "string" ? indexed.key : this.fallbackRecordKey(kind, id));
    const value = await this.readJson<unknown>(key);
    if (value === null) return null;
    const record = this.unwrapRecord(value);
    if (kind === "membership" && isAuthRecord(record, "organization-membership")) {
      const grant = (record as OrganizationMembershipRecord).permissionGrants?.find(
        (candidate) => candidate.membershipId === id,
      );
      if (!grant) return null;
      assertNoPlaintextSecrets(grant);
      return this.wrapRecord(grant as AuthRecordFor<Kind>);
    }
    if (!isAuthRecord(record, kind, id)) {
      throw new Error(`Record identity does not match its S3 object at ${key}`);
    }
    assertNoPlaintextSecrets(record);
    return this.wrapRecord(record as AuthRecordFor<Kind>);
  }

  async readOrganizationMembership(
    organizationId: string,
    subjectId: SubjectId,
    productId?: string,
  ): Promise<OrganizationMembershipRecord | null> {
    assertOpaqueId(organizationId);
    assertOpaqueId(subjectId);
    const key = productId
      ? `${OBJECT_PREFIX}orgs/${organizationId}/products/${safeSegment(productId)}/members/${subjectId}.json`
      : `${OBJECT_PREFIX}orgs/${organizationId}/catalog-managers/${subjectId}.json`;
    const value = await this.readJson<unknown>(key);
    if (value === null) return null;
    const record = this.unwrapRecord(value);
    if (!isAuthRecord(record, "organization-membership")) {
      throw new Error(`Malformed product membership at ${key}`);
    }
    const membership = record as OrganizationMembershipRecord;
    if (
      membership.organizationId !== organizationId ||
      membership.subjectId !== subjectId ||
      (membership.productId ?? undefined) !== productId
    ) {
      throw new Error(`Membership identity does not match its S3 object at ${key}`);
    }
    assertNoPlaintextSecrets(membership);
    return membership;
  }

  async listOrganizationMemberships(
    organizationId: string,
  ): Promise<OrganizationMembershipRecord[]> {
    assertOpaqueId(organizationId);
    const prefix = `${OBJECT_PREFIX}orgs/${organizationId}/`;
    const keys = (await this.listKeys(prefix)).filter((key) =>
      /\/(catalog-managers|members)\/[^/]+\.json$/.test(key),
    );
    const memberships = await mapWithConcurrency(keys, async (key) => {
      const raw = await this.readJson<unknown>(key);
      if (raw === null) return null;
      const record = this.unwrapRecord(raw);
      if (!isAuthRecord(record, "organization-membership")) return null;
      const membership = record as OrganizationMembershipRecord;
      return membership.organizationId === organizationId ? membership : null;
    });
    return memberships.filter(
      (membership): membership is OrganizationMembershipRecord => membership !== null,
    );
  }

  async listMembershipsForSubject(subjectId: SubjectId): Promise<OrganizationMembershipRecord[]> {
    assertOpaqueId(subjectId);
    const prefix = `${INDEX_ROOT}/by-subject/${subjectId}/products/`;
    const keys = await this.listKeys(prefix);
    const pointers = (
      await mapWithConcurrency(keys, async (pointerKey) =>
        this.readJson<{ key?: unknown }>(pointerKey),
      )
    ).flatMap((pointer) => (typeof pointer?.key === "string" ? [pointer.key] : []));
    const memberships = await mapWithConcurrency(pointers, async (key) => {
      const value = await this.readJson<unknown>(key);
      if (value === null) return null;
      const record = this.unwrapRecord(value);
      return isAuthRecord(record, "organization-membership") &&
        (record as OrganizationMembershipRecord).subjectId === subjectId
        ? (record as OrganizationMembershipRecord)
        : null;
    });
    return memberships.filter(
      (membership): membership is OrganizationMembershipRecord => membership !== null,
    );
  }

  async listApiKeysForSubject(subjectId: SubjectId): Promise<ApiKeyRecord[]> {
    assertOpaqueId(subjectId);
    const prefix = `${INDEX_ROOT}/by-subject/${subjectId}/api-keys/`;
    const pointerKeys = await this.listKeys(prefix);
    const pointers = (
      await mapWithConcurrency(pointerKeys, async (pointerKey) =>
        this.readJson<{ key?: unknown }>(pointerKey),
      )
    ).flatMap((pointer) => (typeof pointer?.key === "string" ? [pointer.key] : []));
    const records = await mapWithConcurrency(pointers, async (key) => {
      const value = await this.readJson<unknown>(key);
      if (value === null) return null;
      const record = this.unwrapRecord(value);
      if (!isAuthRecord(record, "api-key")) return null;
      const apiKey = record as ApiKeyRecord;
      return apiKey.owner.kind === "subject" && apiKey.owner.subjectId === subjectId
        ? apiKey
        : null;
    });
    return records.filter((record): record is ApiKeyRecord => record !== null);
  }

  async readProduct(organizationId: string, productId: string): Promise<ProductRecord | null> {
    assertOpaqueId(organizationId);
    const key = `${OBJECT_PREFIX}orgs/${organizationId}/products/${safeSegment(productId)}/product.json`;
    const raw = await this.readJson<unknown>(key);
    if (raw === null) return null;
    const record = this.unwrapRecord(raw);
    if (!isAuthRecord(record, "product")) throw new Error(`Malformed product at ${key}`);
    const product = record as ProductRecord;
    if (product.organizationId !== organizationId || product.productId !== productId) {
      throw new Error(`Product identity does not match its S3 object at ${key}`);
    }
    const sharedProductRef = product.sharedProductRef;
    if (!sharedProductRef) return product;
    if (sharedProductRef.detachedAt) return null;

    const source = await this.readRecord("product", sharedProductRef.sourceProductRecordId);
    if (!source) return null;
    const canonical = source.record as ProductRecord;
    if (
      canonical.sharedProductRef ||
      canonical.visibility !== "public" ||
      canonical.organizationId !== sharedProductRef.sourceOrganizationId ||
      canonical.productRecordId !== sharedProductRef.sourceProductRecordId ||
      canonical.productId !== sharedProductRef.sourceProductId ||
      canonical.productId !== product.productId
    ) {
      return null;
    }
    return {
      ...product,
      name: canonical.name,
      description: canonical.description,
      websiteUrl: canonical.websiteUrl,
      iconUrl: canonical.iconUrl,
      accessRoles: canonical.accessRoles,
      visibility: "public",
      updatedAt: canonical.updatedAt,
    };
  }

  async listProducts(organizationId: string): Promise<ProductRecord[]> {
    assertOpaqueId(organizationId);
    const prefix = `${OBJECT_PREFIX}orgs/${organizationId}/products/`;
    const keys = (await this.listKeys(prefix)).filter((key) => key.endsWith("/product.json"));
    const products = await mapWithConcurrency(keys, async (key) => {
      const raw = await this.readJson<unknown>(key);
      if (raw === null) return null;
      const record = this.unwrapRecord(raw);
      if (!isAuthRecord(record, "product")) return null;
      const local = record as ProductRecord;
      return this.readProduct(organizationId, local.productId);
    });
    return products.filter((product): product is ProductRecord => product !== null);
  }

  async findSubjectIdByEmail(email: string): Promise<SubjectId | null> {
    const normalized = email.trim().toLowerCase();
    const digest = createHmac("sha256", this.identityIndexSecret).update(normalized).digest("hex");
    const value = await this.readJson<{ subjectId?: unknown }>(
      `${INDEX_ROOT}/by-email/${digest}.json`,
    );
    if (typeof value?.subjectId !== "string") return null;
    assertOpaqueId(value.subjectId);
    return value.subjectId as SubjectId;
  }

  async findSubjectIdByUsername(productId: string, username: string): Promise<SubjectId | null> {
    const product = safeSegment(productId);
    const normalized = username.trim().toLowerCase();
    const digest = createHmac("sha256", this.identityIndexSecret)
      .update(`${product}\0${normalized}`)
      .digest("hex");
    const value = await this.readJson<{ subjectId?: unknown }>(
      `${INDEX_ROOT}/by-product-username/${product}/${digest}.json`,
    );
    if (typeof value?.subjectId !== "string") return null;
    assertOpaqueId(value.subjectId);
    return value.subjectId as SubjectId;
  }

  async writeRecord(inputRecord: AuthRecord): Promise<void> {
    const record = lowercaseScopeIdentifiersInRecord(inputRecord) as AuthRecord;
    if (record.schemaVersion !== 1) throw new Error("Unsupported auth record schema version");
    assertOpaqueId(authRecordId(record));
    assertNoPlaintextSecrets(record);
    const key = recordKey(record);
    await this.writeJson(identityIndexKey(record.kind, authRecordId(record)), { key });

    if (record.kind === "subject" && record.primaryEmail) {
      const normalized = record.primaryEmail.trim().toLowerCase();
      const digest = createHmac("sha256", this.identityIndexSecret)
        .update(normalized)
        .digest("hex");
      await this.writeJson(`${INDEX_ROOT}/by-email/${digest}.json`, {
        subjectId: record.subjectId,
      });
    }
    if (record.kind === "subject") {
      for (const identifier of record.loginIdentifiers ?? []) {
        const product = safeSegment(identifier.productId);
        const normalized = identifier.normalizedValue.trim().toLowerCase();
        if (!normalized || normalized.length > 254) {
          throw new Error("Invalid product login identifier");
        }
        const digest = createHmac("sha256", this.identityIndexSecret)
          .update(`${product}\0${normalized}`)
          .digest("hex");
        await this.writeJson(`${INDEX_ROOT}/by-product-username/${product}/${digest}.json`, {
          subjectId: record.subjectId,
        });
      }
    }
    if (record.kind === "organization-membership") {
      const productPart = record.productId ? safeSegment(record.productId) : "_catalog";
      await this.writeJson(
        `${INDEX_ROOT}/by-subject/${record.subjectId}/products/${record.organizationId}/${productPart}.json`,
        { key },
      );
      for (const grant of record.permissionGrants ?? []) {
        await this.writeJson(identityIndexKey("membership", grant.membershipId), { key });
      }
    }
    if (record.kind === "api-key" && record.owner.kind === "subject") {
      await this.writeJson(
        `${INDEX_ROOT}/by-subject/${record.owner.subjectId}/api-keys/${record.apiKeyId}.json`,
        { key },
      );
    }
    if (record.kind === "session") {
      await this.writeJson(
        `${INDEX_ROOT}/by-subject/${record.subjectId}/sessions/${record.sessionId}.json`,
        { key },
      );
    }
    await this.writeJson(key, record);
  }

  async appendEvent(event: AuthEvent): Promise<void> {
    this.validateEvent(event);
    assertNoPlaintextSecrets(event);
    const key = eventKey(event);
    await this.writeJson(key, event);
    const date = datePart(event.occurredAt);
    await this.writeJson(
      `${OBJECT_PREFIX}activity/by-aggregate/${event.aggregate.kind}/${event.aggregate.id}/${event.eventId}.json`,
      { key },
    );
    const organizationId =
      typeof event.payload.organizationId === "string"
        ? event.payload.organizationId
        : event.aggregate.kind === "organization"
          ? event.aggregate.id
          : undefined;
    const productId =
      typeof event.payload.productId === "string" ? event.payload.productId : undefined;
    const subjectId =
      typeof event.payload.subjectId === "string"
        ? event.payload.subjectId
        : event.actor.kind === "subject"
          ? event.actor.subjectId
          : undefined;
    if (organizationId) {
      assertOpaqueId(organizationId);
      await this.writeJson(
        `${OBJECT_PREFIX}activity/by-organization/${organizationId}/${date}/${event.eventId}.json`,
        { key },
      );
    }
    if (organizationId && productId) {
      await this.writeJson(
        `${OBJECT_PREFIX}activity/by-product/${organizationId}/${safeSegment(productId)}/${date}/${event.eventId}.json`,
        { key },
      );
    }
    if (subjectId) {
      assertOpaqueId(subjectId);
      await this.writeJson(
        `${OBJECT_PREFIX}activity/by-subject/${subjectId}/${date}/${event.eventId}.json`,
        { key },
      );
    }
  }

  async readEvent(aggregate: AuthEvent["aggregate"], eventId: EventId): Promise<AuthEvent | null> {
    assertOpaqueId(eventId);
    const pointer = await this.readJson<{ key?: unknown }>(
      `${OBJECT_PREFIX}activity/by-aggregate/${aggregate.kind}/${aggregate.id}/${eventId}.json`,
    );
    if (typeof pointer?.key !== "string") return null;
    const event = await this.readJson<AuthEvent>(pointer.key);
    if (!event) return null;
    this.validateEvent(event);
    return event;
  }

  async listEvents(aggregate: AuthEvent["aggregate"]): Promise<AuthEvent[]> {
    const prefix = `${OBJECT_PREFIX}activity/by-aggregate/${aggregate.kind}/${aggregate.id}/`;
    return this.readEventsFromPointers(prefix);
  }

  async listOrganizationEvents(organizationId: string, productId?: string): Promise<AuthEvent[]> {
    assertOpaqueId(organizationId);
    const prefix = productId
      ? `${OBJECT_PREFIX}activity/by-product/${organizationId}/${safeSegment(productId)}/`
      : `${OBJECT_PREFIX}activity/by-organization/${organizationId}/`;
    return this.readEventsFromPointers(prefix);
  }

  async listAllEvents(): Promise<AuthEvent[]> {
    const keys = await this.listKeys(`${OBJECT_PREFIX}activity/events/`);
    const events: AuthEvent[] = [];
    for (const key of keys) {
      const event = await this.readJson<AuthEvent>(key);
      if (event === null) continue;
      this.validateEvent(event);
      assertNoPlaintextSecrets(event);
      events.push(event);
    }
    return this.sortEvents(events);
  }

  async listRecords<Kind extends AuthRecordKind>(
    kind: Kind,
  ): Promise<VersionedRecord<AuthRecordFor<Kind>>[]> {
    const prefixes: Record<AuthRecordKind, string[]> = {
      organization: [`${OBJECT_PREFIX}orgs/`],
      "organization-membership": [`${OBJECT_PREFIX}orgs/`],
      product: [`${OBJECT_PREFIX}orgs/`],
      "organization-invitation": [`${OBJECT_PREFIX}invitations/`, `${OBJECT_PREFIX}orgs/`],
      subject: [`${OBJECT_PREFIX}subjects/`],
      membership: [`${OBJECT_PREFIX}orgs/`],
      "service-principal": [`${OBJECT_PREFIX}service-principals/`],
      "api-key": [`${OBJECT_PREFIX}api-keys/`],
      "consumer-client": [`${OBJECT_PREFIX}consumer-clients/`],
      "consumer-authorization-code": [`${OBJECT_PREFIX}consumer-authorization-codes/`],
      session: [`${OBJECT_PREFIX}sessions/`],
      "email-action": [`${OBJECT_PREFIX}email-actions/`],
    };
    const keys = (await Promise.all(prefixes[kind].map((prefix) => this.listKeys(prefix)))).flat();
    const records = await mapWithConcurrency([...new Set(keys)], async (key) => {
      if (!key.endsWith(".json") || key.includes("/activity/") || key.includes("/indexes/"))
        return [];
      const value = await this.readJson<unknown>(key);
      if (value === null) return [];
      const record = this.unwrapRecord(value);
      if (kind === "membership" && isAuthRecord(record, "organization-membership")) {
        return ((record as OrganizationMembershipRecord).permissionGrants ?? []).map((grant) =>
          this.wrapRecord(grant as AuthRecordFor<Kind>),
        );
      }
      return isAuthRecord(record, kind) ? [this.wrapRecord(record as AuthRecordFor<Kind>)] : [];
    });
    return records.flat();
  }

  private fallbackRecordKey(kind: AuthRecordKind, id: string): string {
    assertOpaqueId(id);
    const direct: Partial<Record<AuthRecordKind, string>> = {
      subject: `${OBJECT_PREFIX}subjects/${id}.json`,
      organization: `${OBJECT_PREFIX}orgs/${id}/organization.json`,
      "api-key": `${OBJECT_PREFIX}api-keys/${id}.json`,
      "consumer-client": `${OBJECT_PREFIX}consumer-clients/${id}.json`,
      "consumer-authorization-code": `${OBJECT_PREFIX}consumer-authorization-codes/${id}.json`,
      session: `${OBJECT_PREFIX}sessions/${id}.json`,
      "email-action": `${OBJECT_PREFIX}email-actions/${id}.json`,
      "service-principal": `${OBJECT_PREFIX}service-principals/${id}.json`,
      "organization-invitation": `${OBJECT_PREFIX}invitations/${id}.json`,
    };
    if (direct[kind]) return direct[kind]!;
    throw new Error(`An identity index is required to load ${kind} ${id}`);
  }

  private directRecordKey(kind: AuthRecordKind, id: string): string | null {
    switch (kind) {
      case "subject":
        return `${OBJECT_PREFIX}subjects/${id}.json`;
      case "organization":
        return `${OBJECT_PREFIX}orgs/${id}/organization.json`;
      case "api-key":
        return `${OBJECT_PREFIX}api-keys/${id}.json`;
      case "consumer-client":
        return `${OBJECT_PREFIX}consumer-clients/${id}.json`;
      case "consumer-authorization-code":
        return `${OBJECT_PREFIX}consumer-authorization-codes/${id}.json`;
      case "session":
        return `${OBJECT_PREFIX}sessions/${id}.json`;
      case "email-action":
        return `${OBJECT_PREFIX}email-actions/${id}.json`;
      case "service-principal":
        return `${OBJECT_PREFIX}service-principals/${id}.json`;
      default:
        return null;
    }
  }

  private unwrapRecord(value: unknown): unknown {
    if (typeof value !== "object" || value === null) return value;
    if ("record" in value && typeof value.record === "object" && value.record !== null) {
      return lowercaseScopeIdentifiersInRecord(value.record);
    }
    return lowercaseScopeIdentifiersInRecord(value);
  }

  private wrapRecord<RecordType extends AuthRecord>(
    record: RecordType,
  ): VersionedRecord<RecordType> {
    const writtenAt = "updatedAt" in record ? record.updatedAt : record.createdAt;
    return { formatVersion: 1, revision: 1, writtenAt, record };
  }

  private validateEvent(event: AuthEvent): void {
    if (event.schemaVersion !== 1) throw new Error("Unsupported auth activity schema version");
    assertOpaqueId(event.eventId);
    assertOpaqueId(event.aggregate.id);
    if (!Number.isSafeInteger(event.aggregateVersion) || event.aggregateVersion < 1) {
      throw new Error("Activity sequence must be a positive safe integer");
    }
    if (!event.type || event.type.length > 100) throw new Error("Invalid activity event type");
  }

  private async readEventsFromPointers(prefix: string): Promise<AuthEvent[]> {
    const pointers = await this.listKeys(prefix);
    const events: AuthEvent[] = [];
    for (const pointerKey of pointers) {
      const pointer = await this.readJson<{ key?: unknown }>(pointerKey);
      if (typeof pointer?.key !== "string") continue;
      const event = await this.readJson<AuthEvent>(pointer.key);
      if (event) {
        this.validateEvent(event);
        events.push(event);
      }
    }
    return this.sortEvents(events);
  }

  private sortEvents(events: AuthEvent[]): AuthEvent[] {
    return events.sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
        right.eventId.localeCompare(left.eventId),
    );
  }

  private async readJson<Value>(key: string): Promise<Value | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) throw new Error(`Object body is missing at ${key}`);
      return JSON.parse(await result.Body.transformToString()) as Value;
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  private async writeJson(key: string, value: unknown): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
        ACL: "private",
        CacheControl: "no-store",
      }),
    );
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const seenTokens = new Set<string>();
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );
      keys.push(...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
      if (!page.IsTruncated) break;
      const nextToken = page.NextContinuationToken;
      if (!nextToken || seenTokens.has(nextToken)) throw new Error("S3 listing did not advance");
      seenTokens.add(nextToken);
      continuationToken = nextToken;
    } while (true);
    return keys;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function requiredEnvironmentValue(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function createSpacesAuthStoreFromEnv(env: Environment = process.env): SpacesAuthStore {
  const endpoint = requiredEnvironmentValue(env, "PERMINISTER_SPACES_ENDPOINT");
  const region = requiredEnvironmentValue(env, "PERMINISTER_SPACES_REGION");
  const bucket = requiredEnvironmentValue(env, "PERMINISTER_SPACES_BUCKET");
  const parsedEndpoint = new URL(endpoint);
  if (
    parsedEndpoint.protocol !== "https:" ||
    parsedEndpoint.pathname !== "/" ||
    parsedEndpoint.port !== "" ||
    parsedEndpoint.search ||
    parsedEndpoint.hash ||
    parsedEndpoint.username ||
    parsedEndpoint.password ||
    parsedEndpoint.hostname.toLowerCase() !==
      `${bucket.toLowerCase()}.${region.toLowerCase()}.digitaloceanspaces.com`
  ) {
    throw new Error("Spaces endpoint must be the bucket's HTTPS endpoint");
  }

  const client = new S3Client({
    endpoint: `https://${region.toLowerCase()}.digitaloceanspaces.com`,
    region,
    credentials: {
      accessKeyId: requiredEnvironmentValue(env, "PERMINISTER_SPACES_ACCESS_KEY"),
      secretAccessKey: requiredEnvironmentValue(env, "PERMINISTER_SPACES_SECRET_KEY"),
    },
    maxAttempts: 3,
  });

  return new SpacesAuthStore({
    client,
    bucket,
    identityIndexSecret: requiredEnvironmentValue(env, "PERMINISTER_IDENTITY_INDEX_SECRET"),
  });
}
