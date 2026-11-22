import "server-only";

import { createHmac } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { mapWithConcurrency } from "../concurrency";
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
  SubjectRecord,
} from "../domain";
import { assertOpaqueId, authRecordId } from "../domain";
import { SpacesEventStore } from "./event-store";
import {
  assertNoPlaintextSecrets,
  directRecordKey,
  fallbackRecordKey,
  INDEX_ROOT,
  identityIndexKey,
  isAuthRecord,
  isRecordListCandidate,
  lowercaseScopeIdentifiersInRecord,
  OBJECT_PREFIX,
  ORGANIZATION_MEMBERSHIP_INDEX_MANIFEST,
  ORGANIZATION_MEMBERSHIP_INDEX_ROOT,
  recordKey,
  safeSegment,
  unwrapRecord,
  type VersionedRecord,
  wrapRecord,
} from "./keys-and-validation";
import { SpacesRateLimitStore } from "./rate-limit-store";
import { createSpacesClientConfigFromEnv, SpacesS3Client } from "./s3-client";

export type { VersionedRecord };

export interface SpacesAuthStoreOptions {
  client: S3Client;
  bucket: string;
  identityIndexSecret: string;
  readOnly?: boolean;
}

export class SpacesAuthStore {
  private readonly s3: SpacesS3Client;
  private readonly rateLimits: SpacesRateLimitStore;
  private readonly events: SpacesEventStore;
  private readonly identityIndexSecret: string;
  private organizationMembershipIndexReady = false;
  private organizationMembershipIndexCheckedAt = 0;
  private organizationMembershipIndexCheck?: Promise<boolean>;

  constructor({ client, bucket, identityIndexSecret, readOnly = false }: SpacesAuthStoreOptions) {
    if (!bucket.trim()) throw new Error("Spaces bucket is required");
    if (identityIndexSecret.length < 32) {
      throw new Error("Identity index secret must be at least 32 characters");
    }
    this.identityIndexSecret = identityIndexSecret;
    this.s3 = new SpacesS3Client({ client, bucket, readOnly });
    this.rateLimits = new SpacesRateLimitStore(this.s3, identityIndexSecret);
    this.events = new SpacesEventStore(this.s3);
  }

  checkReadiness(): Promise<void> {
    return this.s3.checkReadiness();
  }

  consumeRateLimit(
    namespace: string,
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    return this.rateLimits.consumeRateLimit(namespace, key, limit, windowMs);
  }

  async readRecord<Kind extends AuthRecordKind>(
    kind: Kind,
    id: string,
  ): Promise<VersionedRecord<AuthRecordFor<Kind>> | null> {
    assertOpaqueId(id);
    const directKey = directRecordKey(kind, id);
    const indexed = directKey
      ? null
      : await this.s3.readJson<{ key?: unknown }>(identityIndexKey(kind, id));
    const key =
      directKey ??
      (typeof indexed?.key === "string" ? indexed.key : fallbackRecordKey(kind, id));
    const value = await this.s3.readJson<unknown>(key);
    if (value === null) return null;
    const record = unwrapRecord(value);
    if (kind === "membership" && isAuthRecord(record, "organization-membership")) {
      const grant = (record as OrganizationMembershipRecord).permissionGrants?.find(
        (candidate) => candidate.membershipId === id,
      );
      if (!grant) return null;
      assertNoPlaintextSecrets(grant);
      return wrapRecord(grant as AuthRecordFor<Kind>);
    }
    if (!isAuthRecord(record, kind, id)) {
      throw new Error(`Record identity does not match its S3 object at ${key}`);
    }
    assertNoPlaintextSecrets(record);
    return wrapRecord(record as AuthRecordFor<Kind>);
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
    const value = await this.s3.readJson<unknown>(key);
    if (value === null) return null;
    const record = unwrapRecord(value);
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
    productId?: string | null,
  ): Promise<OrganizationMembershipRecord[]> {
    assertOpaqueId(organizationId);
    const membershipIndexRoot = `${ORGANIZATION_MEMBERSHIP_INDEX_ROOT}/${organizationId}`;
    if (productId === undefined && (await this.hasOrganizationMembershipIndex())) {
      const indexKeys = await this.s3.listKeys(`${membershipIndexRoot}/`);
      const memberships = await mapWithConcurrency(indexKeys, async (indexKey) => {
        const relativePath = indexKey.slice(membershipIndexRoot.length + 1);
        const [productPart, subjectFile, ...extra] = relativePath.split("/");
        if (
          !productPart ||
          !subjectFile?.endsWith(".json") ||
          extra.length > 0 ||
          (productPart !== "_catalog" && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(productPart))
        ) {
          return null;
        }
        const subjectId = subjectFile.slice(0, -".json".length);
        try {
          assertOpaqueId(subjectId);
        } catch {
          return null;
        }
        const membership = await this.readOrganizationMembership(
          organizationId,
          subjectId as SubjectId,
          productPart === "_catalog" ? undefined : productPart,
        );
        return membership && (membership.productId ?? "_catalog") === productPart
          ? membership
          : null;
      });
      return memberships.filter(
        (membership): membership is OrganizationMembershipRecord => membership !== null,
      );
    }

    const legacyPrefix =
      productId === null
        ? `${OBJECT_PREFIX}orgs/${organizationId}/catalog-managers/`
        : productId === undefined
          ? `${OBJECT_PREFIX}orgs/${organizationId}/`
          : `${OBJECT_PREFIX}orgs/${organizationId}/products/${safeSegment(productId)}/members/`;
    const keys = (await this.s3.listKeys(legacyPrefix)).filter((key) =>
      productId === null
        ? /\/catalog-managers\/[^/]+\.json$/.test(key)
        : /\/(catalog-managers|members)\/[^/]+\.json$/.test(key),
    );
    const memberships = await mapWithConcurrency(keys, async (key) => {
      const raw = await this.s3.readJson<unknown>(key);
      if (raw === null) return null;
      const record = unwrapRecord(raw);
      if (!isAuthRecord(record, "organization-membership")) return null;
      const membership = record as OrganizationMembershipRecord;
      return membership.organizationId === organizationId &&
        (productId === undefined || (membership.productId ?? null) === productId)
        ? membership
        : null;
    });
    return memberships.filter(
      (membership): membership is OrganizationMembershipRecord => membership !== null,
    );
  }

  private async hasOrganizationMembershipIndex(): Promise<boolean> {
    if (this.organizationMembershipIndexReady) return true;
    if (Date.now() - this.organizationMembershipIndexCheckedAt < 30_000) return false;
    if (this.organizationMembershipIndexCheck) return this.organizationMembershipIndexCheck;
    const check = this.s3
      .readJson<{ version?: unknown }>(ORGANIZATION_MEMBERSHIP_INDEX_MANIFEST)
      .then((manifest) => {
        this.organizationMembershipIndexReady = manifest?.version === 1;
        this.organizationMembershipIndexCheckedAt = Date.now();
        return this.organizationMembershipIndexReady;
      })
      .finally(() => {
        this.organizationMembershipIndexCheck = undefined;
      });
    this.organizationMembershipIndexCheck = check;
    return check;
  }

  async listMembershipsForSubject(subjectId: SubjectId): Promise<OrganizationMembershipRecord[]> {
    assertOpaqueId(subjectId);
    const prefix = `${INDEX_ROOT}/by-subject/${subjectId}/products/`;
    const keys = await this.s3.listKeys(prefix);
    const membershipKeys = keys.flatMap((pointerKey) => {
      const relativeKey = pointerKey.slice(prefix.length);
      const separator = relativeKey.indexOf("/");
      if (
        separator <= 0 ||
        relativeKey.indexOf("/", separator + 1) !== -1 ||
        !relativeKey.endsWith(".json")
      ) {
        return [];
      }
      const organizationId = relativeKey.slice(0, separator);
      const productPart = relativeKey.slice(separator + 1).replace(/\.json$/, "");
      if (!productPart) return [];
      try {
        assertOpaqueId(organizationId);
        if (productPart !== "_catalog") safeSegment(productPart);
      } catch {
        return [];
      }
      return [
        {
          organizationId,
          productPart,
          key:
            productPart === "_catalog"
              ? `${OBJECT_PREFIX}orgs/${organizationId}/catalog-managers/${subjectId}.json`
              : `${OBJECT_PREFIX}orgs/${organizationId}/products/${productPart}/members/${subjectId}.json`,
        },
      ];
    });
    const memberships = await mapWithConcurrency(
      membershipKeys,
      async ({ key, organizationId, productPart }) => {
        const value = await this.s3.readJson<unknown>(key);
        if (value === null) return null;
        const record = unwrapRecord(value);
        if (!isAuthRecord(record, "organization-membership")) return null;
        const membership = record as OrganizationMembershipRecord;
        return membership.organizationId === organizationId &&
          membership.subjectId === subjectId &&
          (membership.productId ?? "_catalog") === productPart
          ? membership
          : null;
      },
    );
    return memberships.filter(
      (membership): membership is OrganizationMembershipRecord => membership !== null,
    );
  }

  async listApiKeysForSubject(subjectId: SubjectId): Promise<ApiKeyRecord[]> {
    assertOpaqueId(subjectId);
    const prefix = `${INDEX_ROOT}/by-subject/${subjectId}/api-keys/`;
    const indexKeys = await this.s3.listKeys(prefix);
    const records = await mapWithConcurrency(indexKeys, async (indexKey) => {
      const apiKeyId = indexKey.slice(prefix.length).replace(/\.json$/, "");
      try {
        assertOpaqueId(apiKeyId);
      } catch {
        return null;
      }
      const value = await this.s3.readJson<unknown>(`${OBJECT_PREFIX}api-keys/${apiKeyId}.json`);
      if (value === null) return null;
      const record = unwrapRecord(value);
      if (!isAuthRecord(record, "api-key", apiKeyId)) return null;
      const apiKey = record as ApiKeyRecord;
      return apiKey.owner.kind === "subject" && apiKey.owner.subjectId === subjectId
        ? apiKey
        : null;
    });
    return records.filter((record): record is ApiKeyRecord => record !== null);
  }

  async readProduct(organizationId: string, productId: string): Promise<ProductRecord | null> {
    const product = await this.readStoredProduct(organizationId, productId);
    if (!product) return null;
    if (product.deletionStartedAt || product.deletedAt) return null;
    const sharedProductRef = product.sharedProductRef;
    if (!sharedProductRef) return product;
    if (sharedProductRef.detachedAt) return null;

    const source = await this.readRecord("product", sharedProductRef.sourceProductRecordId);
    if (!source) return null;
    const canonical = source.record as ProductRecord;
    if (
      canonical.sharedProductRef ||
      canonical.deletionStartedAt ||
      canonical.deletedAt ||
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
      roleCatalogVersion: canonical.roleCatalogVersion,
      roleCatalogImportedAt: canonical.roleCatalogImportedAt,
      visibility: "public",
      updatedAt: canonical.updatedAt,
    };
  }

  async listProductsByProductId(productId: string): Promise<ProductRecord[]> {
    const normalizedProductId = safeSegment(productId);
    const organizationRoot = `${OBJECT_PREFIX}orgs/`;
    const organizationIds = (await this.s3.listCommonPrefixes(organizationRoot)).flatMap(
      (prefix) => {
        if (!prefix.startsWith(organizationRoot) || !prefix.endsWith("/")) return [];
        const organizationId = prefix.slice(organizationRoot.length, -1);
        if (!organizationId || organizationId.includes("/")) return [];
        try {
          assertOpaqueId(organizationId);
        } catch {
          return [];
        }
        return [organizationId];
      },
    );
    const products = await mapWithConcurrency(organizationIds, (organizationId) =>
      this.readStoredProduct(organizationId, normalizedProductId),
    );
    return products.filter((product): product is ProductRecord => product !== null);
  }

  async listProducts(organizationId: string): Promise<ProductRecord[]> {
    assertOpaqueId(organizationId);
    const prefix = `${OBJECT_PREFIX}orgs/${organizationId}/products/`;
    const keys = (await this.s3.listKeys(prefix)).filter((key) => key.endsWith("/product.json"));
    const products = await mapWithConcurrency(keys, async (key) => {
      const raw = await this.s3.readJson<unknown>(key);
      if (raw === null) return null;
      const record = unwrapRecord(raw);
      if (!isAuthRecord(record, "product")) return null;
      const local = record as ProductRecord;
      const keyProductId = key.slice(prefix.length, -"/product.json".length);
      if (local.organizationId !== organizationId || local.productId !== keyProductId) return null;
      return local.sharedProductRef ? this.readProduct(organizationId, local.productId) : local;
    });
    return products.filter((product): product is ProductRecord => product !== null);
  }

  private async readStoredProduct(
    organizationId: string,
    productId: string,
  ): Promise<ProductRecord | null> {
    assertOpaqueId(organizationId);
    const key = `${OBJECT_PREFIX}orgs/${organizationId}/products/${safeSegment(productId)}/product.json`;
    const raw = await this.s3.readJson<unknown>(key);
    if (raw === null) return null;
    const record = unwrapRecord(raw);
    if (!isAuthRecord(record, "product")) throw new Error(`Malformed product at ${key}`);
    const product = record as ProductRecord;
    if (product.organizationId !== organizationId || product.productId !== productId) {
      throw new Error(`Product identity does not match its S3 object at ${key}`);
    }
    return product;
  }

  async findSubjectIdByEmail(email: string): Promise<SubjectId | null> {
    const normalized = email.trim().toLowerCase();
    const digest = createHmac("sha256", this.identityIndexSecret).update(normalized).digest("hex");
    const value = await this.s3.readJson<{ subjectId?: unknown }>(
      `${INDEX_ROOT}/by-email/${digest}.json`,
    );
    if (typeof value?.subjectId !== "string") return null;
    assertOpaqueId(value.subjectId);
    return value.subjectId as SubjectId;
  }

  async findSubjectIdByExternalIdentity(
    provider: "google",
    providerSubject: string,
  ): Promise<SubjectId | null> {
    const digest = createHmac("sha256", this.identityIndexSecret)
      .update(`${provider}\0${providerSubject}`)
      .digest("hex");
    const value = await this.s3.readJson<{ subjectId?: unknown }>(
      `${INDEX_ROOT}/by-external-identity/${provider}/${digest}.json`,
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
    const value = await this.s3.readJson<{ subjectId?: unknown }>(
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
    if (record.kind === "subject" && record.deletedAt) {
      const previousValue = await this.s3.readJson<unknown>(recordKey(record));
      const previous = unwrapRecord(previousValue);
      if (isAuthRecord(previous, "subject")) {
        await this.deleteSubjectLookupIndexes(previous as SubjectRecord);
      }
    }
    const key = recordKey(record);
    await this.s3.writeJson(identityIndexKey(record.kind, authRecordId(record)), { key });

    if (record.kind === "subject" && record.primaryEmail) {
      const normalized = record.primaryEmail.trim().toLowerCase();
      const digest = createHmac("sha256", this.identityIndexSecret)
        .update(normalized)
        .digest("hex");
      await this.s3.writeJson(`${INDEX_ROOT}/by-email/${digest}.json`, {
        subjectId: record.subjectId,
      });
    }
    if (record.kind === "subject") {
      for (const identity of record.externalIdentities ?? []) {
        if (
          identity.provider !== "google" ||
          typeof identity.subject !== "string" ||
          !/^[\x21-\x7e]{1,255}$/.test(identity.subject)
        ) {
          throw new Error("Invalid external login identity");
        }
        const digest = createHmac("sha256", this.identityIndexSecret)
          .update(`${identity.provider}\0${identity.subject}`)
          .digest("hex");
        const indexKey = `${INDEX_ROOT}/by-external-identity/${identity.provider}/${digest}.json`;
        const existing = await this.s3.readJson<{ subjectId?: unknown }>(indexKey);
        if (typeof existing?.subjectId === "string" && existing.subjectId !== record.subjectId) {
          throw new Error("This external login identity is already linked to another account.");
        }
        await this.s3.writeJson(indexKey, { subjectId: record.subjectId });
      }

      for (const identifier of record.loginIdentifiers ?? []) {
        const product = safeSegment(identifier.productId);
        const normalized = identifier.normalizedValue.trim().toLowerCase();
        if (!normalized || normalized.length > 254) {
          throw new Error("Invalid product login identifier");
        }
        const digest = createHmac("sha256", this.identityIndexSecret)
          .update(`${product}\0${normalized}`)
          .digest("hex");
        await this.s3.writeJson(`${INDEX_ROOT}/by-product-username/${product}/${digest}.json`, {
          subjectId: record.subjectId,
        });
      }
    }
    if (record.kind === "organization-membership") {
      const productPart = record.productId ? safeSegment(record.productId) : "_catalog";
      await this.s3.writeJson(
        `${INDEX_ROOT}/by-subject/${record.subjectId}/products/${record.organizationId}/${productPart}.json`,
        { key },
      );
      await this.s3.writeJson(
        `${ORGANIZATION_MEMBERSHIP_INDEX_ROOT}/${record.organizationId}/${productPart}/${record.subjectId}.json`,
        { key },
      );
      for (const grant of record.permissionGrants ?? []) {
        await this.s3.writeJson(identityIndexKey("membership", grant.membershipId), { key });
      }
    }
    if (record.kind === "api-key" && record.owner.kind === "subject") {
      await this.s3.writeJson(
        `${INDEX_ROOT}/by-subject/${record.owner.subjectId}/api-keys/${record.apiKeyId}.json`,
        { key },
      );
    }
    if (record.kind === "session") {
      await this.s3.writeJson(
        `${INDEX_ROOT}/by-subject/${record.subjectId}/sessions/${record.sessionId}.json`,
        { key },
      );
    }
    await this.s3.writeJson(key, record);
  }

  async moveRecord(previousInput: AuthRecord, nextInput: AuthRecord): Promise<void> {
    const previous = lowercaseScopeIdentifiersInRecord(previousInput) as AuthRecord;
    const next = lowercaseScopeIdentifiersInRecord(nextInput) as AuthRecord;
    if (previous.kind !== next.kind || authRecordId(previous) !== authRecordId(next)) {
      throw new Error("A record move must keep the same record identity.");
    }
    if (next.schemaVersion !== 1) throw new Error("Unsupported auth record schema version");
    assertOpaqueId(authRecordId(next));
    assertNoPlaintextSecrets(next);

    const previousKey = recordKey(previous);
    const nextKey = recordKey(next);
    if (previousKey === nextKey) {
      await this.writeRecord(next);
      return;
    }

    // Prepare the destination object before moving its identity pointer. If a write fails,
    // the original object remains readable and a retry can safely overwrite this copy.
    await this.s3.writeJson(nextKey, next);
    await this.writeRecord(next);
    await this.s3.deleteObjectAtKey(previousKey);

    if (previous.kind === "organization-membership" && previous.productId) {
      const productPart = safeSegment(previous.productId);
      const staleIndexKeys = [
        `${INDEX_ROOT}/by-subject/${previous.subjectId}/products/${previous.organizationId}/${productPart}.json`,
        `${ORGANIZATION_MEMBERSHIP_INDEX_ROOT}/${previous.organizationId}/${productPart}/${previous.subjectId}.json`,
      ];
      await Promise.all(
        staleIndexKeys.map(async (key) => {
          const pointer = await this.s3.readJson<{ key?: unknown }>(key);
          if (pointer?.key === previousKey) await this.s3.deleteObjectAtKey(key);
        }),
      );
    }
  }

  appendEvent(event: AuthEvent): Promise<void> {
    return this.events.appendEvent(event);
  }

  readEvent(aggregate: AuthEvent["aggregate"], eventId: EventId): Promise<AuthEvent | null> {
    return this.events.readEvent(aggregate, eventId);
  }

  listEvents(aggregate: AuthEvent["aggregate"]): Promise<AuthEvent[]> {
    return this.events.listEvents(aggregate);
  }

  listOrganizationEvents(
    organizationId: string,
    productId?: string,
    limit?: number,
  ): Promise<AuthEvent[]> {
    return this.events.listOrganizationEvents(organizationId, productId, limit);
  }

  listAllEvents(): Promise<AuthEvent[]> {
    return this.events.listAllEvents();
  }

  listRecentEvents(limit: number): Promise<AuthEvent[]> {
    return this.events.listRecentEvents(limit);
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
      "oauth-client-registration": [`${OBJECT_PREFIX}oauth-client-registrations/`],
      "consumer-authorization-code": [`${OBJECT_PREFIX}consumer-authorization-codes/`],
      session: [`${OBJECT_PREFIX}sessions/`],
      "email-action": [`${OBJECT_PREFIX}email-actions/`],
    };
    const keys = (await Promise.all(prefixes[kind].map((prefix) => this.s3.listKeys(prefix)))).flat();
    const records = await mapWithConcurrency(
      [...new Set(keys)].filter((key) => isRecordListCandidate(kind, key)),
      async (key) => {
        const value = await this.s3.readJson<unknown>(key);
        if (value === null) return [];
        const record = unwrapRecord(value);
        if (kind === "membership" && isAuthRecord(record, "organization-membership")) {
          return ((record as OrganizationMembershipRecord).permissionGrants ?? []).map((grant) =>
            wrapRecord(grant as AuthRecordFor<Kind>),
          );
        }
        return isAuthRecord(record, kind) ? [wrapRecord(record as AuthRecordFor<Kind>)] : [];
      },
    );
    return records.flat();
  }

  private async deleteSubjectLookupIndexes(subject: SubjectRecord): Promise<void> {
    this.s3.assertWritable();
    const keys = new Set<string>();
    if (subject.primaryEmail) {
      const digest = createHmac("sha256", this.identityIndexSecret)
        .update(subject.primaryEmail.trim().toLowerCase())
        .digest("hex");
      keys.add(`${INDEX_ROOT}/by-email/${digest}.json`);
    }
    for (const identifier of subject.loginIdentifiers ?? []) {
      const product = safeSegment(identifier.productId);
      const normalized = identifier.normalizedValue.trim().toLowerCase();
      const digest = createHmac("sha256", this.identityIndexSecret)
        .update(`${product}\0${normalized}`)
        .digest("hex");
      keys.add(`${INDEX_ROOT}/by-product-username/${product}/${digest}.json`);
    }
    for (const identity of subject.externalIdentities ?? []) {
      const digest = createHmac("sha256", this.identityIndexSecret)
        .update(`${identity.provider}\0${identity.subject}`)
        .digest("hex");
      keys.add(`${INDEX_ROOT}/by-external-identity/${identity.provider}/${digest}.json`);
    }
    await Promise.all(
      [...keys].map(async (key) => {
        const pointer = await this.s3.readJson<{ subjectId?: unknown }>(key);
        if (pointer?.subjectId === subject.subjectId) {
          await this.s3.deleteObjectAtKey(key);
        }
      }),
    );
  }
}

export function createSpacesAuthStoreFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SpacesAuthStore {
  return new SpacesAuthStore(createSpacesClientConfigFromEnv(env));
}
