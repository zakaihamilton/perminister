import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const INVITATION_ID = "88888888-8888-4888-8888-888888888888";
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
  objectReads = 0;
  listRequests = 0;

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
    this.objectReads += 1;
    if (kind === "membership") {
      for (const value of this.records.values()) {
        if (value.record.kind !== "organization-membership") continue;
        const grant = value.record.permissionGrants?.find((item) => item.membershipId === id);
        if (grant) return { ...value, record: grant };
      }
      return null;
    }
    return this.records.get(this.key(kind, id)) ?? null;
  }

  async readOrganizationMembership(organizationId: string, subjectId: string, productId?: string) {
    this.objectReads += 1;
    return (
      [...this.records.values()]
        .map((value) => value.record)
        .find(
          (record): record is Extract<AuthRecord, { kind: "organization-membership" }> =>
            record.kind === "organization-membership" &&
            record.organizationId === organizationId &&
            record.subjectId === subjectId &&
            (record.productId ?? undefined) === productId,
        ) ?? null
    );
  }

  async listOrganizationMemberships(organizationId: string) {
    this.listRequests += 1;
    return [...this.records.values()]
      .map((value) => value.record)
      .filter(
        (record): record is Extract<AuthRecord, { kind: "organization-membership" }> =>
          record.kind === "organization-membership" &&
          (!organizationId || record.organizationId === organizationId),
      );
  }

  async listMembershipsForSubject(subjectId: string) {
    this.listRequests += 1;
    return [...this.records.values()]
      .map((value) => value.record)
      .filter(
        (record): record is Extract<AuthRecord, { kind: "organization-membership" }> =>
          record.kind === "organization-membership" && record.subjectId === subjectId,
      );
  }

  async readProduct(organizationId: string, productId: string) {
    this.objectReads += 1;
    return (
      [...this.records.values()]
        .map((value) => value.record)
        .find(
          (record): record is Extract<AuthRecord, { kind: "product" }> =>
            record.kind === "product" &&
            record.organizationId === organizationId &&
            record.productId === productId,
        ) ?? null
    );
  }

  async listProducts(organizationId: string) {
    this.listRequests += 1;
    return [...this.records.values()]
      .map((value) => value.record)
      .filter(
        (record): record is Extract<AuthRecord, { kind: "product" }> =>
          record.kind === "product" && record.organizationId === organizationId,
      );
  }

  async findSubjectIdByEmail(email: string) {
    this.objectReads += 1;
    return (
      [...this.records.values()]
        .map((value) => value.record)
        .find(
          (record): record is Extract<AuthRecord, { kind: "subject" }> =>
            record.kind === "subject" && record.primaryEmail === email,
        )?.subjectId ?? null
    );
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
    this.listRequests += 1;
    if (kind === "membership") {
      return [...this.records.values()].flatMap((value) =>
        value.record.kind === "organization-membership"
          ? (value.record.permissionGrants ?? []).map((record) => ({ ...value, record }))
          : [],
      );
    }
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
    kind: "organization",
    schemaVersion: 1,
    organizationId: ORGANIZATION_ID as never,
    name: "Legacy Organization",
    createdBySubjectId: SUBJECT_ID as never,
    createdAt: now,
    updatedAt: now,
  } as AuthRecord);
  store.seed({
    kind: "organization-membership",
    schemaVersion: 1,
    organizationMembershipId: ORG_MEMBERSHIP_ID as never,
    organizationId: ORGANIZATION_ID as never,
    productId: SCOPE.productId,
    subjectId: SUBJECT_ID as never,
    role: "member",
    status: "active",
    permissionGrants: [
      {
        kind: "membership",
        schemaVersion: 1,
        membershipId: GRANT_ID as never,
        subjectId: SUBJECT_ID as never,
        scope: SCOPE,
        grants: [{ scope: SCOPE, actions: ["project.read"] }],
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ],
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

  it("authorizes a fresh read when the key, account, product membership, and grant are active", async () => {
    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toEqual({
      authorized: true,
      subjectId: SUBJECT_ID,
    });
  });

  it.each(["pending", "rejected"] as const)(
    "denies API authorization when the organization is %s",
    async (approvalStatus) => {
      const organization = store.records.get(store.key("organization", ORGANIZATION_ID))!
        .record as Extract<AuthRecord, { kind: "organization" }>;
      store.seed({ ...organization, approvalStatus });

      await expect(service.authorizeApiKey(TOKEN, request)).resolves.toEqual({ authorized: false });
    },
  );

  it("keeps legacy organizations without an approval status available", async () => {
    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toMatchObject({
      authorized: true,
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
      "a disabled product membership",
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
        const record = fakeStore.records.get(
          fakeStore.key("organization-membership", ORG_MEMBERSHIP_ID),
        )!.record as Extract<AuthRecord, { kind: "organization-membership" }>;
        fakeStore.seed({
          ...record,
          permissionGrants: (record.permissionGrants ?? []).map((grant) => ({
            ...grant,
            status: "disabled",
          })),
        });
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

  it("uses four direct object reads and no S3 listing for authorization", async () => {
    store.events.push({
      schemaVersion: 1,
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never,
      aggregate: { kind: "organization", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never },
      aggregateVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { kind: "system" },
      type: "organization.updated",
      payload: {},
    });
    store.objectReads = 0;
    store.listRequests = 0;

    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toMatchObject({
      authorized: true,
    });
    expect(store.objectReads).toBe(4);
    expect(store.listRequests).toBe(0);
  });

  it("does not treat a product role as an API action grant", async () => {
    const member = store.records.get(store.key("organization-membership", ORG_MEMBERSHIP_ID))!
      .record as Extract<AuthRecord, { kind: "organization-membership" }>;
    store.seed({ ...member, permissionGrants: [] });
    await expect(service.authorizeApiKey(TOKEN, request)).resolves.toEqual({ authorized: false });
  });

  it("reactivates a removed product membership without changing its ID or restoring grants", async () => {
    const existing = store.records.get(store.key("organization-membership", ORG_MEMBERSHIP_ID))!
      .record as Extract<AuthRecord, { kind: "organization-membership" }>;
    store.seed({
      ...existing,
      status: "disabled",
      permissionGrants: (existing.permissionGrants ?? []).map((grant) => ({
        ...grant,
        status: "disabled",
      })),
    });

    const token = `${INVITATION_ID}.${"b".repeat(43)}`;
    store.seed({
      kind: "organization-invitation",
      schemaVersion: 1,
      invitationId: INVITATION_ID as never,
      organizationId: ORGANIZATION_ID as never,
      productId: SCOPE.productId,
      email: "person@example.com",
      role: "member",
      verifierDigestHex: createHash("sha256").update(token).digest("hex"),
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      consumedAt: null,
      revokedAt: null,
    } as AuthRecord);

    await expect(service.acceptOrganizationInvitation(SUBJECT_ID as never, token)).resolves.toBe(
      ORGANIZATION_ID,
    );

    expect(store.writes).toContainEqual(
      expect.objectContaining({
        kind: "organization-membership",
        organizationMembershipId: ORG_MEMBERSHIP_ID,
        status: "active",
        permissionGrants: [expect.objectContaining({ membershipId: GRANT_ID, status: "disabled" })],
      }),
    );
  });

  it("releases a sign-in reservation when the account lookup fails", async () => {
    const findSubjectIdByEmail = store.findSubjectIdByEmail.bind(store);
    store.findSubjectIdByEmail = async () => {
      throw new Error("Spaces unavailable");
    };

    await expect(service.authenticate("person@example.com", "wrong-password")).rejects.toThrow(
      "Spaces unavailable",
    );

    store.findSubjectIdByEmail = findSubjectIdByEmail;
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

describe("organization approval", () => {
  let store: MemoryStore;
  let service: typeof import("../../src/lib/auth/service");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "");
    store = new MemoryStore();
    seedAuthorizationData(store);
    mocks.store = store;
    service = await import("../../src/lib/auth/service");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a pending request with an owner and blocks a second pending request", async () => {
    const organization = await service.createOrganization(SUBJECT_ID as never, "Northstar");

    expect(organization.approvalStatus).toBe("pending");
    await expect(service.listOrganizationsForSubject(SUBJECT_ID as never)).resolves.toMatchObject([
      { organization: { name: "Legacy Organization" } },
    ]);
    await expect(
      service.getOrganizationForSubject(SUBJECT_ID as never, organization.organizationId),
    ).rejects.toThrow("Organization not found.");
    await expect(service.createOrganization(SUBJECT_ID as never, "Second request")).rejects.toThrow(
      "An organization request is already pending.",
    );
    await expect(
      service.listOrganizationRequestsForSubject(SUBJECT_ID as never),
    ).resolves.toMatchObject([{ organization: { name: "Northstar" }, status: "pending" }]);
    const memberships = (await store.listRecords("organization-membership")).map(
      (value) => value.record,
    );
    expect(memberships).toContainEqual(
      expect.objectContaining({
        organizationId: organization.organizationId,
        subjectId: SUBJECT_ID,
        role: "owner",
        status: "active",
      }),
    );
  });

  it("blocks product creation and API-key creation while a request is pending", async () => {
    const organization = await service.createOrganization(SUBJECT_ID as never, "Pending Org");

    await expect(
      service.createOrganizationProduct(SUBJECT_ID as never, organization.organizationId, {
        productId: "pending-product",
        name: "Pending Product",
        description: "",
        websiteUrl: "https://example.com",
        iconUrl: "",
      }),
    ).rejects.toThrow("Organization not found.");
    await expect(
      service.createApiKeyForSubject(SUBJECT_ID as never, {
        scope: { ...SCOPE, organizationId: organization.organizationId },
        actions: ["project.read"],
        expiresAt: null,
      }),
    ).rejects.toThrow("Organization not found.");
  });

  it("lets a configured administrator approve a request and only reviews pending requests", async () => {
    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "person@example.com");
    const organization = await service.createOrganization(SUBJECT_ID as never, "Approved Org");

    await expect(
      service.listPendingOrganizationsForAdministrator(SUBJECT_ID as never),
    ).resolves.toMatchObject([
      {
        organizationId: organization.organizationId,
        name: "Approved Org",
        requesterEmail: "person@example.com",
      },
    ]);
    await service.decideOrganizationRequest(
      SUBJECT_ID as never,
      organization.organizationId,
      "approved",
    );

    await expect(
      service.getOrganizationForSubject(SUBJECT_ID as never, organization.organizationId),
    ).resolves.toMatchObject({ organization: { approvalStatus: "approved" } });
    await expect(service.listOrganizationsForSubject(SUBJECT_ID as never)).resolves.toHaveLength(2);
    await expect(
      service.decideOrganizationRequest(
        SUBJECT_ID as never,
        organization.organizationId,
        "rejected",
      ),
    ).rejects.toThrow("Only pending organization requests can be reviewed.");
  });

  it("keeps rejected requests visible and allows a new request afterward", async () => {
    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "person@example.com");
    const rejected = await service.createOrganization(SUBJECT_ID as never, "Rejected Org");
    await service.decideOrganizationRequest(
      SUBJECT_ID as never,
      rejected.organizationId,
      "rejected",
    );

    await expect(
      service.listOrganizationRequestsForSubject(SUBJECT_ID as never),
    ).resolves.toMatchObject([
      { organization: { name: "Rejected Org", approvalStatus: "rejected" }, status: "rejected" },
    ]);
    const replacement = await service.createOrganization(SUBJECT_ID as never, "Replacement Org");
    expect(replacement.approvalStatus).toBe("pending");
  });

  it("does not let a non-administrator decide a request", async () => {
    const organization = await service.createOrganization(SUBJECT_ID as never, "Needs Review");

    await expect(
      service.decideOrganizationRequest(
        SUBJECT_ID as never,
        organization.organizationId,
        "approved",
      ),
    ).rejects.toThrow("Administrator access is required.");
    expect(organization.approvalStatus).toBe("pending");
  });
});

describe("S3-shaped membership model", () => {
  let store: MemoryStore;
  let service: typeof import("../../src/lib/auth/service");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "person@example.com");
    store = new MemoryStore();
    seedAuthorizationData(store);
    mocks.store = store;
    service = await import("../../src/lib/auth/service");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("treats a product member as organization access without making them a catalog manager", async () => {
    const summary = await service.getOrganizationForSubject(SUBJECT_ID as never, ORGANIZATION_ID);
    expect(summary.catalogManager).toBe(false);
    expect(summary.membership.role).toBe("member");
    expect(summary.membership.productId).toBeUndefined();
  });

  it("assigns the product creator a product Owner membership", async () => {
    const organization = await service.createOrganization(SUBJECT_ID as never, "Atlas Org");
    await service.decideOrganizationRequest(
      SUBJECT_ID as never,
      organization.organizationId,
      "approved",
    );
    const product = await service.createOrganizationProduct(
      SUBJECT_ID as never,
      organization.organizationId,
      {
        productId: "atlas-next",
        name: "Atlas Next",
        description: "",
        websiteUrl: "https://example.com",
        iconUrl: "",
      },
    );
    const membership = await store.readOrganizationMembership(
      organization.organizationId,
      SUBJECT_ID,
      product.productId,
    );
    expect(membership).toMatchObject({ role: "owner", status: "active", productId: "atlas-next" });
  });
});
