import "server-only";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  ApiKeyRecord,
  AuthAggregate,
  AuthEvent,
  AuthRecord,
  AuthRecordFor,
  AuthRecordKind,
  EventId,
  MembershipRecord,
  SubjectRecord,
} from "../domain";
import { assertOpaqueId } from "../domain";

const OBJECT_ROOT = "authodox/v1";
const RECORD_COLLECTION: Record<AuthRecordKind, string> = {
  subject: "subjects",
  membership: "memberships",
  "api-key": "api-keys",
};

export interface VersionedRecord<RecordType extends AuthRecord = AuthRecord> {
  formatVersion: 1;
  revision: number;
  writtenAt: string;
  record: RecordType;
}

export interface SpacesAuthStoreOptions {
  client: S3Client;
  bucket: string;
}

function assertNoPlaintextSecrets(value: unknown, path = "record"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoPlaintextSecrets(item, `${path}[${index}]`),
    );
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
      (normalizedKey.startsWith("password") &&
        normalizedKey !== "passwordcredential");
    if (isPlaintextCredentialField) {
      throw new Error(`Refusing to persist plaintext credential field at ${path}.${key}`);
    }
    assertNoPlaintextSecrets(nested, `${path}.${key}`);
  }
}

function recordId(record: AuthRecord): string {
  switch (record.kind) {
    case "subject":
      return record.subjectId;
    case "membership":
      return record.membershipId;
    case "api-key":
      return record.apiKeyId;
  }
}

function aggregatePath(aggregate: AuthAggregate): string {
  assertOpaqueId(aggregate.id);
  return `${aggregate.kind}/${aggregate.id}`;
}

function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchKey" ||
    (candidate.name === "NotFound" && candidate.$metadata?.httpStatusCode === 404)
  );
}

function validateRecordEnvelope(value: unknown): value is VersionedRecord {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Partial<VersionedRecord>;
  return (
    envelope.formatVersion === 1 &&
    Number.isSafeInteger(envelope.revision) &&
    (envelope.revision ?? 0) >= 1 &&
    typeof envelope.writtenAt === "string" &&
    typeof envelope.record === "object" &&
    envelope.record !== null
  );
}

export class SpacesAuthStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor({ client, bucket }: SpacesAuthStoreOptions) {
    if (!bucket.trim()) throw new Error("Spaces bucket is required");
    this.client = client;
    this.bucket = bucket;
  }

  async readRecord<Kind extends AuthRecordKind>(
    kind: Kind,
    id: string,
  ): Promise<VersionedRecord<AuthRecordFor<Kind>> | null> {
    assertOpaqueId(id);
    const key = `${OBJECT_ROOT}/records/${RECORD_COLLECTION[kind]}/${id}.json`;
    const value = await this.readJson<unknown>(key);
    if (value === null) return null;
    if (!validateRecordEnvelope(value)) {
      throw new Error(`Unsupported or malformed record at ${key}`);
    }

    assertNoPlaintextSecrets(value.record);
    const record = value.record as AuthRecord;
    if (
      record.schemaVersion !== 1 ||
      record.kind !== kind ||
      recordId(record) !== id
    ) {
      throw new Error(`Record identity does not match its object key at ${key}`);
    }
    return value as VersionedRecord<AuthRecordFor<Kind>>;
  }

  async writeRecord(record: AuthRecord, revision: number): Promise<void> {
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error("Record revision must be a positive safe integer");
    }
    if (record.schemaVersion !== 1) {
      throw new Error("Unsupported auth record schema version");
    }
    const id = recordId(record);
    assertOpaqueId(id);
    assertNoPlaintextSecrets(record);

    const envelope: VersionedRecord = {
      formatVersion: 1,
      revision,
      writtenAt: new Date().toISOString(),
      record,
    };
    const key = `${OBJECT_ROOT}/records/${RECORD_COLLECTION[record.kind]}/${id}.json`;
    await this.writeJson(key, envelope);
  }

  async appendEvent(event: AuthEvent): Promise<void> {
    this.validateEvent(event);
    assertNoPlaintextSecrets(event);
    const key = this.eventKey(event.aggregate, event.eventId);
    await this.writeJson(key, event);
  }

  async readEvent(
    aggregate: AuthAggregate,
    eventId: EventId,
  ): Promise<AuthEvent | null> {
    assertOpaqueId(eventId);
    const event = await this.readJson<AuthEvent>(this.eventKey(aggregate, eventId));
    if (event === null) return null;
    this.validateEvent(event);
    assertNoPlaintextSecrets(event);
    if (
      event.aggregate.kind !== aggregate.kind ||
      event.aggregate.id !== aggregate.id ||
      event.eventId !== eventId
    ) {
      throw new Error("Event identity does not match its object key");
    }
    return event;
  }

  async listEvents(aggregate: AuthAggregate): Promise<AuthEvent[]> {
    const prefix = `${OBJECT_ROOT}/events/${aggregatePath(aggregate)}/`;
    const keys = await this.listKeys(prefix);
    const events: AuthEvent[] = [];

    for (const key of keys) {
      const event = await this.readJson<AuthEvent>(key);
      if (event === null) continue;
      this.validateEvent(event);
      assertNoPlaintextSecrets(event);
      if (
        event.aggregate.kind !== aggregate.kind ||
        event.aggregate.id !== aggregate.id
      ) {
        throw new Error(`Event aggregate does not match its object key at ${key}`);
      }
      events.push(event);
    }

    return events.sort(
      (left, right) =>
        left.aggregateVersion - right.aggregateVersion ||
        left.eventId.localeCompare(right.eventId),
    );
  }

  private eventKey(aggregate: AuthAggregate, eventId: EventId): string {
    assertOpaqueId(eventId);
    return `${OBJECT_ROOT}/events/${aggregatePath(aggregate)}/${eventId}.json`;
  }

  private validateEvent(event: AuthEvent): void {
    if (event.schemaVersion !== 1) {
      throw new Error("Unsupported auth event schema version");
    }
    assertOpaqueId(event.eventId);
    assertOpaqueId(event.aggregate.id);
    if (!Number.isSafeInteger(event.aggregateVersion) || event.aggregateVersion < 1) {
      throw new Error("Event aggregate version must be a positive safe integer");
    }
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
      if (!nextToken || seenTokens.has(nextToken)) {
        throw new Error("Spaces event listing did not advance");
      }
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

export function createSpacesAuthStoreFromEnv(
  env: Environment = process.env,
): SpacesAuthStore {
  const endpoint = requiredEnvironmentValue(env, "AUTHODOX_SPACES_ENDPOINT");
  const region = requiredEnvironmentValue(env, "AUTHODOX_SPACES_REGION");
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
      `${region.toLowerCase()}.digitaloceanspaces.com`
  ) {
    throw new Error("Spaces endpoint must be a regional HTTPS endpoint");
  }

  const client = new S3Client({
    endpoint: parsedEndpoint.origin,
    region,
    credentials: {
      accessKeyId: requiredEnvironmentValue(env, "AUTHODOX_SPACES_ACCESS_KEY"),
      secretAccessKey: requiredEnvironmentValue(env, "AUTHODOX_SPACES_SECRET_KEY"),
    },
    maxAttempts: 3,
  });

  return new SpacesAuthStore({
    client,
    bucket: requiredEnvironmentValue(env, "AUTHODOX_SPACES_BUCKET"),
  });
}

export type StoredAuthRecord = VersionedRecord<
  SubjectRecord | MembershipRecord | ApiKeyRecord
>;
