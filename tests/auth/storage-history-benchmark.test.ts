import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthEvent,
  AuthRecord,
  AuthRecordKind,
  ResourceScope,
} from "../../src/lib/auth/domain";

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
const TOKEN = `pmk_${API_KEY_ID}_${"a".repeat(43)}`;
const SCOPE: ResourceScope = {
  kind: "product",
  organizationId: ORGANIZATION_ID as never,
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
    case "api-key":
      return record.apiKeyId;
    case "session":
      return record.sessionId;
    case "email-action":
      return record.actionId;
  }
}

class ModeledSpacesStore {
  readonly records = new Map<
    string,
    { formatVersion: 1; revision: number; writtenAt: string; record: AuthRecord }
  >();
  events: AuthEvent[] = [];
  objectReads = 0;
  listRequests = 0;

  seed(record: AuthRecord) {
    this.records.set(`${record.kind}:${storedId(record)}`, {
      formatVersion: 1,
      revision: 1,
      writtenAt: new Date().toISOString(),
      record,
    });
  }

  resetCounts() {
    this.objectReads = 0;
    this.listRequests = 0;
  }

  async readRecord(kind: AuthRecordKind, id: string) {
    this.objectReads += 1;
    return this.records.get(`${kind}:${id}`) ?? null;
  }

  async listEvents(aggregate: AuthEvent["aggregate"]) {
    this.listRequests += 1;
    const events = this.events.filter(
      (event) => event.aggregate.kind === aggregate.kind && event.aggregate.id === aggregate.id,
    );
    this.objectReads += events.length;
    return events;
  }

  async listAllEvents() {
    this.listRequests += 1;
    this.objectReads += this.events.length;
    return [...this.events];
  }

  async listRecords(kind: AuthRecordKind) {
    this.listRequests += 1;
    const records = [...this.records.values()].filter((value) => value.record.kind === kind);
    this.objectReads += records.length;
    return records;
  }

  async writeRecord() {
    throw new Error("Authorization benchmark should not write records");
  }
}

function seedAuthorizationData(store: ModeledSpacesStore) {
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
  } as AuthRecord);
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

function historyEvents(count: number): AuthEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    schemaVersion: 1,
    eventId: `${String(index + 1).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` as never,
    aggregate: {
      kind: "organization",
      id: `${String(index + 1).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb` as never,
    },
    aggregateVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    actor: { kind: "system" },
    type: "organization.updated",
    payload: {},
  })) as AuthEvent[];
}

describe("modeled Spaces authorization history benchmark", () => {
  let store: ModeledSpacesStore;
  let authorizeApiKey: (typeof import("../../src/lib/auth/service"))["authorizeApiKey"];

  beforeEach(async () => {
    vi.resetModules();
    store = new ModeledSpacesStore();
    seedAuthorizationData(store);
    mocks.store = store;
    ({ authorizeApiKey } = await import("../../src/lib/auth/service"));
  });

  it("records latency and object reads as unrelated event history grows", async () => {
    const results: Array<{
      eventHistory: number;
      averageLatencyMs: number;
      objectReadsPerRequest: number;
      listRequestsPerRequest: number;
    }> = [];

    for (const eventHistory of [0, 100, 500, 1000]) {
      store.events = historyEvents(eventHistory);
      store.resetCounts();
      const iterations = 10;
      const startedAt = performance.now();
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const result = await authorizeApiKey(TOKEN, {
          organizationId: ORGANIZATION_ID,
          productId: "atlas",
          resourceKind: "project",
          resourceId: "billing",
          action: "project.read",
        });
        expect(result.authorized).toBe(true);
      }
      const elapsedMs = performance.now() - startedAt;
      results.push({
        eventHistory,
        averageLatencyMs: Number((elapsedMs / iterations).toFixed(3)),
        objectReadsPerRequest: store.objectReads / iterations,
        listRequestsPerRequest: store.listRequests / iterations,
      });
    }

    console.info("Modeled Spaces authorization benchmark", JSON.stringify(results));
    expect(results[3].objectReadsPerRequest).toBeGreaterThan(results[0].objectReadsPerRequest);
    expect(results.every((result) => result.listRequestsPerRequest > 0)).toBe(true);
  });
});
