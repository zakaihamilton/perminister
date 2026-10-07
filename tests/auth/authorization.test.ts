import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthEvent,
  AuthRecord,
  AuthRecordKind,
  ResourceScope,
} from "../../src/lib/auth/domain";
import { appendDirectoryRegistrationAndCheckIntegrity } from "../../src/lib/auth/integrity";

const mocks = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/auth/storage/spaces", () => ({
  createSpacesAuthStoreFromEnv: () => mocks.store,
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "33333333-3333-4333-8333-333333333333";
const API_KEY_ID = "55555555-5555-4555-8555-555555555555";
const ORG_MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";
const GRANT_ID = "77777777-7777-4777-8777-777777777777";
const DIRECTORY_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = `pmk_${API_KEY_ID}_${"a".repeat(43)}`;
const SCOPE: ResourceScope = {
  kind: "product",
  organizationId: ORGANIZATION_ID as ResourceScope["organizationId"],
  productId: "atlas",
};

function storedId(record: AuthRecord): string {
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

class MemoryStore {
  readonly records = new Map<
    string,
    { formatVersion: 1; revision: number; writtenAt: string; record: AuthRecord }
  >();
  readonly events: AuthEvent[] = [];
  readonly writes: AuthRecord[] = [];
  private appendBarrierCount = 0;
  private appendBarrierRelease: (() => void) | undefined;
  private readonly appendBarrier = new Promise<void>((resolve) => {
    this.appendBarrierRelease = resolve;
  });

  key(kind: AuthRecordKind, id: string) {
    return `${kind}:${id}`;
  }

  seed(record: AuthRecord) {
    this.records.set(this.key(record.kind, storedId(record)), {
      formatVersion: 1,
      revision: 1,
      writtenAt: new Date().toISOString(),
      record,
    });
  }

  async readRecord(kind: AuthRecordKind, id: string) {
    return this.records.get(this.key(kind, id)) ?? null;
  }

  async listEvents(aggregate: AuthEvent["aggregate"]) {
    return this.events.filter(
      (event) => event.aggregate.kind === aggregate.kind && event.aggregate.id === aggregate.id,
    );
  }

  async listAllEvents() {
    return [...this.events];
  }

  async listRecords(kind: AuthRecordKind) {
    return [...this.records.values()].filter((value) => value.record.kind === kind);
  }

  async writeRecord(record: AuthRecord, revision: number) {
    this.writes.push(record);
    this.records.set(this.key(record.kind, storedId(record)), {
      formatVersion: 1,
      revision,
      writtenAt: new Date().toISOString(),
      record,
    });
  }

  async appendEvent(event: AuthEvent) {
    this.events.push(event);
    if (!this.appendBarrierRelease) return;
    this.appendBarrierCount += 1;
    if (this.appendBarrierCount === 2) this.appendBarrierRelease();
    await this.appendBarrier;
  }
}

function seedAuthorizationData(store: MemoryStore) {
  const now = new Date().toISOString();
  store.seed({
    kind: "subject",
    schemaVersion: 1,
    subjectId: SUBJECT_ID as never,
    status: "active",
    primaryEmail: "person@example.com",
    emailVerifiedAt: now,
    passwordCredential: null,
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as unknown as AuthRecord);
  store.seed({
    kind: "organization-membership",
    schemaVersion: 1,
    organizationMembershipId: ORG_MEMBERSHIP_ID as never,
    organizationId: ORGANIZATION_ID as never,
    subjectId: SUBJECT_ID as never,
    role: "member",
    status: "active",
    createdAt: now,
    updatedAt: now,
  } as AuthRecord);
  store.seed({
    kind: "membership",
    schemaVersion: 1,
    membershipId: GRANT_ID as never,
    subjectId: SUBJECT_ID as never,
    scope: SCOPE,
    grants: [{ scope: SCOPE, actions: ["project.read"] }],
    status: "active",
    createdAt: now,
    updatedAt: now,
  } as AuthRecord);
  store.seed({
    kind: "api-key",
    schemaVersion: 1,
    apiKeyId: API_KEY_ID as never,
    keyClass: "integration",
    owner: { kind: "subject", subjectId: SUBJECT_ID as never },
    scope: SCOPE,
    actions: ["project.read"],
    verifier: { algorithm: "sha256", digestHex: createHash("sha256").update(TOKEN).digest("hex") },
    status: "active",
    createdAt: now,
    expiresAt: null,
    revokedAt: null,
    rotatedFromApiKeyId: null,
  } as AuthRecord);
}

const request = {
  organizationId: ORGANIZATION_ID,
  productId: "atlas",
  resourceKind: "project" as const,
  resourceId: "billing",
  action: "project.read",
};

describe("bearer authorization", () => {
  let store: MemoryStore;
  let service: typeof import("../../src/lib/auth/service");

  beforeEach(async () => {
    vi.resetModules();
    store = new MemoryStore();
    seedAuthorizationData(store);
    mocks.store = store;
    service = await import("../../src/lib/auth/service");
  });

  it("authorizes a fresh read when the key, account, organization membership, and grant are active", async () => {
    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toEqual({
      authorized: true,
      subjectId: SUBJECT_ID,
    });
  });

  it.each([
    [
      "a disabled account",
      (fakeStore: MemoryStore) => {
        const record = fakeStore.records.get(fakeStore.key("subject", SUBJECT_ID))!
          .record as Extract<AuthRecord, { kind: "subject" }>;
        fakeStore.seed({ ...record, status: "disabled" });
      },
    ],
    [
      "a disabled organization membership",
      (fakeStore: MemoryStore) => {
        const record = fakeStore.records.get(
          fakeStore.key("organization-membership", ORG_MEMBERSHIP_ID),
        )!.record as Extract<AuthRecord, { kind: "organization-membership" }>;
        fakeStore.seed({ ...record, status: "disabled" });
      },
    ],
    [
      "a disabled permission grant",
      (fakeStore: MemoryStore) => {
        const record = fakeStore.records.get(fakeStore.key("membership", GRANT_ID))!
          .record as Extract<AuthRecord, { kind: "membership" }>;
        fakeStore.seed({ ...record, status: "disabled" });
      },
    ],
    [
      "an expired key",
      (fakeStore: MemoryStore) => {
        const record = fakeStore.records.get(fakeStore.key("api-key", API_KEY_ID))!
          .record as Extract<AuthRecord, { kind: "api-key" }>;
        fakeStore.seed({ ...record, expiresAt: "2000-01-01T00:00:00.000Z" });
      },
    ],
    [
      "a revoked key",
      (fakeStore: MemoryStore) => {
        const record = fakeStore.records.get(fakeStore.key("api-key", API_KEY_ID))!
          .record as Extract<AuthRecord, { kind: "api-key" }>;
        fakeStore.seed({ ...record, status: "revoked", revokedAt: new Date().toISOString() });
      },
    ],
  ])("denies %s", async (_label, alterStore) => {
    alterStore(store);
    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toEqual({ authorized: false });
  });

  it("observes a later Spaces record change on the next authorization call", async () => {
    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toMatchObject({
      authorized: true,
    });
    const membership = store.records.get(store.key("organization-membership", ORG_MEMBERSHIP_ID))!
      .record as Extract<AuthRecord, { kind: "organization-membership" }>;
    store.seed({ ...membership, status: "disabled" });
    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toEqual({ authorized: false });
  });

  it("stops recovery when duplicate revisions exist and leaves the snapshot untouched", async () => {
    const aggregate: AuthEvent["aggregate"] = { kind: "api-key", id: API_KEY_ID as never };
    const current = store.records.get(store.key("api-key", API_KEY_ID))!.record;
    store.events.push(
      {
        schemaVersion: 1,
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never,
        aggregate,
        aggregateVersion: 2,
        occurredAt: new Date().toISOString(),
        actor: { kind: "system" },
        type: "key.first",
        payload: { record: current as never },
      },
      {
        schemaVersion: 1,
        eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as never,
        aggregate,
        aggregateVersion: 2,
        occurredAt: new Date().toISOString(),
        actor: { kind: "system" },
        type: "key.second",
        payload: { record: current as never },
      },
    );

    await expect(service.authorizeApiKey(TOKEN, request)).rejects.toMatchObject({
      name: "AuthDataIntegrityError",
    });
    expect(store.writes).toEqual([]);
  });

  it("detects duplicate registrations when reading the directory", async () => {
    const directory = { kind: "directory", id: DIRECTORY_ID } as AuthEvent["aggregate"];
    for (const [eventId, subjectId, version] of [
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", SUBJECT_ID, 1],
      ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "44444444-4444-4444-8444-444444444444", 2],
    ]) {
      store.events.push({
        schemaVersion: 1,
        eventId: eventId as never,
        aggregate: directory,
        aggregateVersion: version,
        occurredAt: new Date().toISOString(),
        actor: { kind: "system" },
        type: "identity.registered",
        payload: { email: "person@example.com", subjectId },
      } as AuthEvent);
    }

    await expect(service.findAccountByEmail("person@example.com")).rejects.toMatchObject({
      name: "AuthDataIntegrityError",
    });
  });

  it("recovers a snapshot from a complete single event after an interrupted write", async () => {
    const key = store.records.get(store.key("api-key", API_KEY_ID))!.record as Extract<
      AuthRecord,
      { kind: "api-key" }
    >;
    const recovered = { ...key, status: "revoked" as const, revokedAt: new Date().toISOString() };
    store.events.push({
      schemaVersion: 1,
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never,
      aggregate: { kind: "api-key", id: API_KEY_ID as never },
      aggregateVersion: 2,
      occurredAt: new Date().toISOString(),
      actor: { kind: "system" },
      type: "api-key.revoked",
      payload: { record: recovered as never },
    });

    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toEqual({ authorized: false });
    expect(store.records.get(store.key("api-key", API_KEY_ID))?.record).toMatchObject({
      status: "revoked",
    });
    expect(store.writes).toHaveLength(1);
  });

  it("releases a sign-in reservation when the account lookup fails", async () => {
    const listEvents = store.listEvents.bind(store);
    store.listEvents = async () => {
      throw new Error("Spaces unavailable");
    };

    await expect(service.authenticate("person@example.com", "wrong-password")).rejects.toThrow(
      "Spaces unavailable",
    );

    store.listEvents = listEvents;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(service.authenticate("person@example.com", "wrong-password")).rejects.toThrow(
        "Email or password is incorrect.",
      );
    }
    await expect(service.authenticate("person@example.com", "wrong-password")).rejects.toThrow(
      "Too many sign-in attempts. Try again later.",
    );
  });
});

describe("concurrent registration writes from independent app processes", () => {
  it("detects two registrations that claim the same directory revision", async () => {
    const sharedSpaces = new MemoryStore();
    const directory = { kind: "directory", id: DIRECTORY_ID } as AuthEvent["aggregate"];
    const registration = (eventId: string, subjectId: string): AuthEvent => ({
      schemaVersion: 1,
      eventId: eventId as never,
      aggregate: directory,
      aggregateVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { kind: "system" },
      type: "identity.registered",
      payload: { email: "person@example.com", subjectId },
    });

    const outcomes = await Promise.allSettled([
      appendDirectoryRegistrationAndCheckIntegrity(
        sharedSpaces,
        registration("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", SUBJECT_ID),
      ),
      appendDirectoryRegistrationAndCheckIntegrity(
        sharedSpaces,
        registration(
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "44444444-4444-4444-8444-444444444444",
        ),
      ),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    expect(
      outcomes.every(
        (outcome) =>
          outcome.status === "rejected" && outcome.reason.name === "AuthDataIntegrityError",
      ),
    ).toBe(true);
    expect(sharedSpaces.writes).toEqual([]);
  });

  it("detects duplicate email registrations even when their revisions differ", async () => {
    const sharedSpaces = new MemoryStore();
    const directory = { kind: "directory", id: DIRECTORY_ID } as AuthEvent["aggregate"];
    const registration = (
      eventId: string,
      subjectId: string,
      aggregateVersion: number,
    ): AuthEvent => ({
      schemaVersion: 1,
      eventId: eventId as never,
      aggregate: directory,
      aggregateVersion,
      occurredAt: new Date().toISOString(),
      actor: { kind: "system" },
      type: "identity.registered",
      payload: { email: "person@example.com", subjectId },
    });

    const outcomes = await Promise.allSettled([
      appendDirectoryRegistrationAndCheckIntegrity(
        sharedSpaces,
        registration("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", SUBJECT_ID, 1),
      ),
      appendDirectoryRegistrationAndCheckIntegrity(
        sharedSpaces,
        registration(
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "44444444-4444-4444-8444-444444444444",
          2,
        ),
      ),
    ]);

    expect(
      outcomes.every(
        (outcome) =>
          outcome.status === "rejected" && outcome.reason.name === "AuthDataIntegrityError",
      ),
    ).toBe(true);
  });
});
