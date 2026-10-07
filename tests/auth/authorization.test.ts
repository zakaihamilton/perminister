import { createHash, scryptSync } from "node:crypto";
import { hash as hashArgon2id } from "@node-rs/argon2";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessGrantActionsFields } from "../../src/components/access-grant-actions-fields";
import type {
  AuthEvent,
  AuthRecord,
  AuthRecordKind,
  ResourceScope,
} from "../../src/lib/auth/domain";
import type { ProductAccessRole } from "../../src/lib/auth/access-roles";

const mocks = vi.hoisted(() => ({ store: undefined as unknown }));
const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigationMocks);
vi.mock("../../src/lib/auth/storage/spaces", () => ({
  createSpacesAuthStoreFromEnv: () => mocks.store,
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "33333333-3333-4333-8333-333333333333";
const API_KEY_ID = "55555555-5555-4555-8555-555555555555";
const ORG_MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";
const GRANT_ID = "77777777-7777-4777-8777-777777777777";
const INVITATION_ID = "88888888-8888-4888-8888-888888888888";
const ROLE_PRODUCT_RECORD_ID = "99999999-9999-4999-8999-999999999999";
const ROLE_TARGET_SUBJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE_TARGET_MEMBERSHIP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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

  async findSubjectIdByUsername(productId: string, username: string) {
    this.objectReads += 1;
    return (
      [...this.records.values()]
        .map((value) => value.record)
        .find(
          (record): record is Extract<AuthRecord, { kind: "subject" }> =>
            record.kind === "subject" &&
            record.loginIdentifiers?.some(
              (identifier) =>
                identifier.productId === productId &&
                identifier.normalizedValue === username.trim().toLowerCase(),
            ) === true,
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

function seedProductAccessRoleFixture(store: MemoryStore) {
  const now = new Date().toISOString();
  const actorMembership = store.records.get(
    store.key("organization-membership", ORG_MEMBERSHIP_ID),
  )!.record as Extract<AuthRecord, { kind: "organization-membership" }>;
  store.seed({ ...actorMembership, role: "owner" });
  store.seed({
    kind: "product",
    schemaVersion: 1,
    productRecordId: ROLE_PRODUCT_RECORD_ID as never,
    organizationId: ORGANIZATION_ID as never,
    productId: SCOPE.productId as never,
    name: "Atlas",
    description: "",
    websiteUrl: "https://atlas.example.com",
    iconUrl: "",
    createdBySubjectId: SUBJECT_ID as never,
    createdAt: now,
    updatedAt: now,
  } as AuthRecord);
  store.seed({
    kind: "subject",
    schemaVersion: 1,
    subjectId: ROLE_TARGET_SUBJECT_ID as never,
    status: "active",
    primaryEmail: "member@example.com",
    emailVerifiedAt: now,
    passwordCredential: null,
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as AuthRecord);
  store.seed({
    kind: "organization-membership",
    schemaVersion: 1,
    organizationMembershipId: ROLE_TARGET_MEMBERSHIP_ID as never,
    organizationId: ORGANIZATION_ID as never,
    productId: SCOPE.productId as never,
    subjectId: ROLE_TARGET_SUBJECT_ID as never,
    role: "member",
    status: "active",
    permissionGrants: [],
    createdAt: now,
    updatedAt: now,
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

describe("consumer identity migration and management", () => {
  let store: MemoryStore;
  let service: typeof import("../../src/lib/auth/service");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "");
    store = new MemoryStore();
    seedAuthorizationData(store);
    for (const [index, productId] of ["visitoring", "postparticle"].entries()) {
      store.seed({
        kind: "product",
        schemaVersion: 1,
        productRecordId: (index === 0 ? ROLE_PRODUCT_RECORD_ID : API_KEY_ID) as never,
        organizationId: ORGANIZATION_ID as never,
        productId,
        name: productId,
        description: "",
        websiteUrl: "https://example.com",
        iconUrl: "",
        createdBySubjectId: SUBJECT_ID as never,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as AuthRecord);
    }
    mocks.store = store;
    service = await import("../../src/lib/auth/service");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies and upgrades Visitoring Argon2id and PostParticle scrypt credentials", async () => {
    const password = "Legacy password long enough 7!";
    const now = new Date().toISOString();
    const argonHash = await hashArgon2id(password);
    const postParticleSalt = "0123456789abcdef0123456789abcdef";
    const postParticleHash = `${postParticleSalt}:${scryptSync(password, postParticleSalt, 64).toString("hex")}`;
    const visitoringId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const postParticleId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    store.seed({
      kind: "subject",
      schemaVersion: 1,
      subjectId: visitoringId as never,
      status: "active",
      primaryEmail: "argon@example.com",
      emailVerifiedAt: null,
      emailVerificationExempt: true,
      passwordCredential: {
        algorithm: "argon2id",
        format: "argon2id-phc",
        encodedVerifier: argonHash,
        updatedAt: now,
      },
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "subject",
      schemaVersion: 1,
      subjectId: postParticleId as never,
      status: "active",
      primaryEmail: null,
      emailVerifiedAt: null,
      emailVerificationExempt: true,
      loginIdentifiers: [
        { kind: "username", productId: "postparticle", value: "writer", normalizedValue: "writer" },
      ],
      passwordCredential: {
        algorithm: "scrypt",
        format: "postparticle-scrypt-v1",
        encodedVerifier: postParticleHash,
        updatedAt: now,
      },
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);

    await expect(
      service.authenticate("argon@example.com", password, "visitoring"),
    ).resolves.toMatchObject({
      subjectId: visitoringId,
    });
    await expect(service.authenticate("writer", password, "postparticle")).resolves.toMatchObject({
      subjectId: postParticleId,
    });
    expect(store.records.get(store.key("subject", visitoringId))?.record).toMatchObject({
      passwordCredential: { algorithm: "scrypt", format: "perminister-scrypt-v1" },
    });
    expect(store.records.get(store.key("subject", postParticleId))?.record).toMatchObject({
      passwordCredential: { algorithm: "scrypt", format: "perminister-scrypt-v1" },
    });

    const session = await service.createConsumerSession(
      postParticleId as never,
      "postparticle",
      "postparticle",
      8 * 60 * 60 * 1000,
    );
    expect(Date.parse(session.session.expiresAt) - Date.parse(session.session.createdAt)).toBe(
      8 * 60 * 60 * 1000,
    );
    await expect(
      service.getConsumerSessionFromToken(session.token, "postparticle"),
    ).resolves.toMatchObject({ subject: { subjectId: postParticleId } });
  });

  it("reports duplicate-email credential conflicts, imports the selected identity, and is idempotent", async () => {
    const argonHash = await hashArgon2id("Visitoring password 123!");
    const salt = "abcdef0123456789abcdef0123456789";
    const postParticleHash = `${salt}:${scryptSync("PostParticle password 123!", salt, 64).toString("hex")}`;
    const input = {
      visitoring: {
        organizationId: ORGANIZATION_ID,
        users: [{ id: "visitor-user-1", email: "shared@example.com", passwordHash: argonHash }],
        memberships: [
          { userId: "visitor-user-1", workspaceId: "workspace-1", role: "admin" as const },
        ],
      },
      postparticle: {
        organizationId: ORGANIZATION_ID,
        users: [
          {
            username: "sharedwriter",
            email: "shared@example.com",
            passwordHash: postParticleHash,
            platformAdmin: true,
          },
        ],
        memberships: [
          { username: "sharedwriter", projectId: "project-1", role: "editor" as const },
        ],
      },
    };

    const dryRun = await service.importLegacyAuthData(
      input,
      { visitoringProductId: "visitoring", postparticleProductId: "postparticle" },
      true,
    );
    expect(dryRun.applied).toBe(false);
    expect(dryRun.conflicts).toMatchObject([
      {
        identity: "email:shared@example.com",
        candidates: ["visitoring:visitor-user-1", "postparticle:sharedwriter"],
      },
    ]);
    expect(store.writes).toHaveLength(0);

    const resolved = await service.importLegacyAuthData(
      {
        ...input,
        credentialSelections: { "email:shared@example.com": "visitoring:visitor-user-1" },
      },
      { visitoringProductId: "visitoring", postparticleProductId: "postparticle" },
      false,
    );
    expect(resolved.applied).toBe(true);
    const subjectId = await store.findSubjectIdByEmail("shared@example.com");
    expect(subjectId).toBeTruthy();
    const subject = store.records.get(store.key("subject", subjectId!))?.record;
    expect(subject).toMatchObject({
      emailVerificationExempt: true,
      primaryEmail: "shared@example.com",
      loginIdentifiers: [
        expect.objectContaining({ productId: "postparticle", normalizedValue: "sharedwriter" }),
      ],
      passwordCredential: { algorithm: "argon2id", format: "argon2id-phc" },
    });
    const importedSession = await service.createConsumerSession(
      subjectId as never,
      "visitoring",
      "visitoring",
      30 * 24 * 60 * 60 * 1000,
    );
    expect(
      Date.parse(importedSession.session.expiresAt) - Date.parse(importedSession.session.createdAt),
    ).toBe(30 * 24 * 60 * 60 * 1000);

    const postparticleAccess = await service.listConsumerOrganizationsForSubject(
      subjectId as never,
      "postparticle",
    );
    expect(postparticleAccess[0]).toMatchObject({ platformAdmin: true });
    expect(postparticleAccess[0]?.resourceRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "platform-admin" }),
        expect.objectContaining({ role: "editor" }),
      ]),
    );
    const grantCountBefore = (await store.listRecords("membership")).length;
    const rerun = await service.importLegacyAuthData(
      {
        ...input,
        credentialSelections: { "email:shared@example.com": "visitoring:visitor-user-1" },
      },
      { visitoringProductId: "visitoring", postparticleProductId: "postparticle" },
      false,
    );
    expect(rerun.applied).toBe(true);
    expect((await store.listRecords("membership")).length).toBe(grantCountBefore);
  });

  it("rejects duplicate source account references even when their emails differ", async () => {
    const passwordHash = await hashArgon2id("Visitoring password 123!");
    const report = await service.importLegacyAuthData(
      {
        visitoring: {
          organizationId: ORGANIZATION_ID,
          users: [
            { id: "reused-source-id", email: "first@example.com", passwordHash },
            { id: "reused-source-id", email: "second@example.com", passwordHash },
          ],
          memberships: [],
        },
      },
      { visitoringProductId: "visitoring" },
      true,
    );
    expect(report.errors).toContain(
      "Duplicate legacy account reference: visitoring:reused-source-id",
    );
    expect(report.applied).toBe(false);
    expect(store.writes).toHaveLength(0);
  });

  it("keeps PostParticle account disable and session revocation scoped to that product", async () => {
    const password = "Shared legacy password 123!";
    const visitoringHash = await hashArgon2id(password);
    const salt = "0123456789abcdef0123456789abcdef";
    const postParticleHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    const imported = await service.importLegacyAuthData(
      {
        visitoring: {
          organizationId: ORGANIZATION_ID,
          users: [
            { id: "shared-person", email: "shared@example.com", passwordHash: visitoringHash },
          ],
          memberships: [{ userId: "shared-person", workspaceId: "workspace-1", role: "viewer" }],
        },
        postparticle: {
          organizationId: ORGANIZATION_ID,
          users: [
            {
              username: "writer",
              email: "shared@example.com",
              passwordHash: postParticleHash,
              disabled: true,
            },
            {
              username: "platformadmin",
              email: "admin@example.com",
              passwordHash: postParticleHash,
              platformAdmin: true,
            },
          ],
          memberships: [{ username: "writer", projectId: "project-1", role: "editor" }],
        },
        credentialSelections: { "email:shared@example.com": "visitoring:shared-person" },
      },
      { visitoringProductId: "visitoring", postparticleProductId: "postparticle" },
      false,
    );
    expect(imported.applied).toBe(true);
    const sharedId = await store.findSubjectIdByEmail("shared@example.com");
    const adminId = await store.findSubjectIdByUsername("postparticle", "platformadmin");
    expect(sharedId).toBeTruthy();
    expect(adminId).toBeTruthy();
    expect(store.records.get(store.key("subject", sharedId!))?.record).toMatchObject({
      status: "active",
      consumerProductStates: [{ productId: "postparticle", status: "disabled", sessionVersion: 2 }],
    });

    const visitoringSession = await service.createConsumerSession(
      sharedId as never,
      "visitoring",
      "visitoring",
      30 * 24 * 60 * 60 * 1000,
    );
    await expect(
      service.authenticate("shared@example.com", password, "visitoring"),
    ).resolves.toMatchObject({
      subjectId: sharedId,
    });
    await expect(service.authenticate("writer", password, "postparticle")).rejects.toThrow(
      "Email or password is incorrect.",
    );
    await expect(
      service.createConsumerSession(sharedId as never, "postparticle", "postparticle"),
    ).rejects.toThrow("disabled for the application");

    await service.updateConsumerAccount(adminId as never, "postparticle", sharedId!, {
      organizationId: ORGANIZATION_ID,
      productId: "postparticle",
      status: "active",
    });
    const postParticleSession = await service.createConsumerSession(
      sharedId as never,
      "postparticle",
      "postparticle",
      8 * 60 * 60 * 1000,
    );
    await service.updateConsumerAccount(adminId as never, "postparticle", sharedId!, {
      organizationId: ORGANIZATION_ID,
      productId: "postparticle",
      revokeSessions: true,
    });
    await expect(
      service.getConsumerSessionFromToken(postParticleSession.token, "postparticle"),
    ).resolves.toBeNull();
    await expect(
      service.getConsumerSessionFromToken(visitoringSession.token, "visitoring"),
    ).resolves.toBeTruthy();
  });

  it("keeps Visitoring members workspace-scoped and protects the last active administrator", async () => {
    const visitorPasswordHash = await hashArgon2id("Visitoring password 123!");
    const imported = await service.importLegacyAuthData(
      {
        visitoring: {
          organizationId: ORGANIZATION_ID,
          users: [
            {
              id: "workspace-admin",
              email: "admin@example.com",
              passwordHash: visitorPasswordHash,
            },
            {
              id: "workspace-viewer",
              email: "viewer@example.com",
              passwordHash: visitorPasswordHash,
            },
          ],
          memberships: [
            { userId: "workspace-admin", workspaceId: "workspace-1", role: "admin" },
            { userId: "workspace-viewer", workspaceId: "workspace-1", role: "viewer" },
          ],
        },
      },
      { visitoringProductId: "visitoring" },
      false,
    );
    expect(imported.applied).toBe(true);
    const actorId = await store.findSubjectIdByEmail("admin@example.com");
    const targetId = await store.findSubjectIdByEmail("viewer@example.com");
    expect(actorId).toBeTruthy();
    expect(targetId).toBeTruthy();

    const viewerSession = await service.createConsumerSession(
      targetId as never,
      "visitoring",
      "visitoring",
    );
    await expect(
      service.authorizeApiKey(
        viewerSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "visitoring",
          resourceKind: "workspace",
          resourceId: "workspace-1",
          action: "visitoring:workspace:read",
        },
        "visitoring",
      ),
    ).resolves.toMatchObject({ authorized: true });
    await expect(
      service.authorizeApiKey(
        viewerSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "visitoring",
          resourceKind: "workspace",
          resourceId: "workspace-1",
          action: "visitoring:members:manage",
        },
        "visitoring",
      ),
    ).resolves.toMatchObject({ authorized: false });

    const targetBefore = store.records.get(store.key("subject", targetId!))?.record;
    const attached = await service.createConsumerMember(actorId as never, "visitoring", {
      organizationId: ORGANIZATION_ID,
      productId: "visitoring",
      scopeKind: "workspace",
      resourceId: "workspace-1",
      email: "viewer@example.com",
      password: "Ignored because the account already exists 7!",
      role: "viewer",
    });
    expect(attached.created).toBe(false);
    expect(attached.member.subjectId).toBe(targetId);
    expect(store.records.get(store.key("subject", targetId!))?.record).toEqual(targetBefore);

    const members = await service.listConsumerMembers(actorId as never, "visitoring", {
      organizationId: ORGANIZATION_ID,
      productId: "visitoring",
      scopeKind: "workspace",
      resourceId: "workspace-1",
    });
    expect(members).toHaveLength(2);
    await expect(
      service.listConsumerMembers(actorId as never, "visitoring", {
        organizationId: ORGANIZATION_ID,
        productId: "visitoring",
        scopeKind: "workspace",
        resourceId: "workspace-2",
      }),
    ).rejects.toThrow("permission");
    await expect(
      service.updateConsumerMember(actorId as never, "visitoring", actorId!, {
        organizationId: ORGANIZATION_ID,
        productId: "visitoring",
        scopeKind: "workspace",
        resourceId: "workspace-1",
        role: "viewer",
      }),
    ).rejects.toThrow("another administrator");
    await expect(
      service.updateConsumerMember(actorId as never, "visitoring", targetId!, {
        organizationId: ORGANIZATION_ID,
        productId: "visitoring",
        scopeKind: "workspace",
        resourceId: "workspace-1",
        role: "admin",
      }),
    ).resolves.toBeUndefined();
  });

  it("enforces PostParticle project roles and platform-admin account controls", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const password = "PostParticle legacy password 123!";
    const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    const imported = await service.importLegacyAuthData(
      {
        postparticle: {
          organizationId: ORGANIZATION_ID,
          users: [
            {
              username: "platformadmin",
              email: "platform@example.com",
              passwordHash,
              platformAdmin: true,
            },
            { username: "projectadmin", email: "projectadmin@example.com", passwordHash },
            { username: "writer", passwordHash },
          ],
          memberships: [
            { username: "projectadmin", projectId: "project-1", role: "admin" },
            { username: "writer", projectId: "project-1", role: "editor" },
          ],
        },
      },
      { postparticleProductId: "postparticle" },
      false,
    );
    expect(imported.applied).toBe(true);
    const platformAdminId = await store.findSubjectIdByUsername("postparticle", "platformadmin");
    const projectAdminId = await store.findSubjectIdByUsername("postparticle", "projectadmin");
    const writerId = await store.findSubjectIdByUsername("postparticle", "writer");
    expect(platformAdminId).toBeTruthy();
    expect(projectAdminId).toBeTruthy();
    expect(writerId).toBeTruthy();

    const editorSession = await service.createConsumerSession(
      writerId as never,
      "postparticle",
      "postparticle",
    );
    await expect(
      service.authorizeApiKey(
        editorSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "postparticle",
          resourceKind: "project",
          resourceId: "project-1",
          action: "postparticle:project:write",
        },
        "postparticle",
      ),
    ).resolves.toMatchObject({ authorized: true });
    await expect(
      service.authorizeApiKey(
        editorSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "postparticle",
          resourceKind: "project",
          resourceId: "project-1",
          action: "postparticle:members:manage",
        },
        "postparticle",
      ),
    ).resolves.toMatchObject({ authorized: false });
    const platformSession = await service.createConsumerSession(
      platformAdminId as never,
      "postparticle",
      "postparticle",
    );
    await expect(
      service.authorizeApiKey(
        platformSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "postparticle",
          resourceKind: "product",
          action: "postparticle:accounts:manage",
        },
        "postparticle",
      ),
    ).resolves.toMatchObject({ authorized: true });

    const listed = await service.listConsumerMembers(platformAdminId as never, "postparticle", {
      organizationId: ORGANIZATION_ID,
      productId: "postparticle",
      scopeKind: "project",
      resourceId: "project-1",
    });
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectId: projectAdminId, role: "admin" }),
        expect.objectContaining({ subjectId: writerId, role: "editor" }),
      ]),
    );
    await expect(
      service.listConsumerMembers(projectAdminId as never, "postparticle", {
        organizationId: ORGANIZATION_ID,
        productId: "postparticle",
        scopeKind: "project",
        resourceId: "project-2",
      }),
    ).rejects.toThrow("permission");
    await expect(
      service.listConsumerAccounts(
        projectAdminId as never,
        "postparticle",
        ORGANIZATION_ID,
        "postparticle",
      ),
    ).rejects.toThrow("Platform administrator");

    const accounts = await service.listConsumerAccounts(
      platformAdminId as never,
      "postparticle",
      ORGANIZATION_ID,
      "postparticle",
    );
    expect(accounts).toHaveLength(3);
    const addedPlatformAdmin = await service.createConsumerAccount(
      platformAdminId as never,
      "postparticle",
      {
        organizationId: ORGANIZATION_ID,
        productId: "postparticle",
        username: "additional-admin",
        password: "Another PostParticle password 123!",
        platformAdmin: true,
      },
    );
    expect(addedPlatformAdmin).toMatchObject({
      created: true,
      account: { username: "additional-admin", platformAdmin: true },
    });
    await service.updateConsumerAccount(
      platformAdminId as never,
      "postparticle",
      addedPlatformAdmin.account.subjectId,
      {
        organizationId: ORGANIZATION_ID,
        productId: "postparticle",
        platformAdmin: false,
      },
    );
    const updatedPlatformAdmins = await service.listConsumerAccounts(
      platformAdminId as never,
      "postparticle",
      ORGANIZATION_ID,
      "postparticle",
    );
    expect(
      updatedPlatformAdmins.find((account) => account.username === "additional-admin")
        ?.platformAdmin,
    ).toBe(false);
    const created = await service.createConsumerMember(platformAdminId as never, "postparticle", {
      organizationId: ORGANIZATION_ID,
      productId: "postparticle",
      scopeKind: "project",
      resourceId: "project-2",
      username: "new-writer",
      password: "New PostParticle password 123!",
      role: "viewer",
    });
    expect(created).toMatchObject({ created: true, member: { role: "viewer", active: true } });

    const writerSession = await service.createConsumerSession(
      writerId as never,
      "postparticle",
      "postparticle",
      8 * 60 * 60 * 1000,
    );
    await expect(
      service.getConsumerSessionFromToken(writerSession.token, "postparticle"),
    ).resolves.toBeTruthy();
    vi.stubEnv("PERMINISTER_APP_CLIENT_IDS", "postparticle");
    vi.stubEnv("PERMINISTER_APP_CLIENT_POSTPARTICLE_SECRET", "p".repeat(40));
    vi.stubEnv("PERMINISTER_APP_CLIENT_POSTPARTICLE_PRODUCT_ID", "postparticle");
    const { consumerRequestContext } = await import("../../src/lib/auth/consumer-route");
    const validHeaders = {
      "x-perminister-client-id": "postparticle",
      "x-perminister-client-secret": "p".repeat(40),
      authorization: `Bearer ${writerSession.token}`,
    };
    await expect(
      consumerRequestContext(
        new Request("https://perminister.example/api", { headers: validHeaders }),
      ),
    ).resolves.toMatchObject({ current: { subject: { subjectId: writerId } } });
    await expect(
      consumerRequestContext(
        new Request("https://perminister.example/api", {
          headers: { ...validHeaders, "x-perminister-client-secret": "bad" },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      consumerRequestContext(
        new Request("https://perminister.example/api", {
          headers: { ...validHeaders, authorization: "Bearer invalid-session" },
        }),
      ),
    ).resolves.toBeNull();
    const storedSession = store.records.get(
      store.key("session", writerSession.session.sessionId),
    )?.record;
    expect(storedSession?.kind).toBe("session");
    if (storedSession?.kind === "session") {
      store.seed({ ...storedSession, expiresAt: new Date(Date.now() - 1000).toISOString() });
    }
    await expect(
      service.getConsumerSessionFromToken(writerSession.token, "postparticle"),
    ).resolves.toBeNull();

    const resetSession = await service.createConsumerSession(
      writerId as never,
      "postparticle",
      "postparticle",
      8 * 60 * 60 * 1000,
    );
    await service.updateConsumerMember(platformAdminId as never, "postparticle", writerId!, {
      organizationId: ORGANIZATION_ID,
      productId: "postparticle",
      scopeKind: "project",
      resourceId: "project-1",
      role: "viewer",
      password: "Reset PostParticle password 456!",
    });
    await expect(
      service.getConsumerSessionFromToken(resetSession.token, "postparticle"),
    ).resolves.toBeNull();

    const secondSession = await service.createConsumerSession(
      writerId as never,
      "postparticle",
      "postparticle",
      8 * 60 * 60 * 1000,
    );
    await service.updateConsumerAccount(platformAdminId as never, "postparticle", writerId!, {
      organizationId: ORGANIZATION_ID,
      productId: "postparticle",
      status: "disabled",
    });
    await expect(
      service.getConsumerSessionFromToken(secondSession.token, "postparticle"),
    ).resolves.toBeNull();
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

describe("product access roles", () => {
  let store: MemoryStore;
  let service: typeof import("../../src/lib/auth/service");

  beforeEach(async () => {
    vi.resetModules();
    store = new MemoryStore();
    seedAuthorizationData(store);
    seedProductAccessRoleFixture(store);
    mocks.store = store;
    service = await import("../../src/lib/auth/service");
  });

  it.each(["owner", "admin"] as const)(
    "allows a product %s to create and remove reusable roles",
    async (role) => {
      const actorMembership = store.records.get(
        store.key("organization-membership", ORG_MEMBERSHIP_ID),
      )!.record as Extract<AuthRecord, { kind: "organization-membership" }>;
      store.seed({ ...actorMembership, role });

      const accessRole = await service.createProductAccessRole(
        SUBJECT_ID as never,
        ORGANIZATION_ID,
        SCOPE.productId,
        { name: "Telemetry viewer", description: "Read telemetry", actions: ["telemetry.read"] },
      );
      expect(
        (await store.readProduct(ORGANIZATION_ID, SCOPE.productId))?.accessRoles,
      ).toContainEqual(accessRole);

      await service.removeProductAccessRole(
        SUBJECT_ID as never,
        ORGANIZATION_ID,
        SCOPE.productId,
        accessRole.id,
      );
      expect((await store.readProduct(ORGANIZATION_ID, SCOPE.productId))?.accessRoles).toEqual([]);
    },
  );

  it("prevents a product member from creating or removing roles", async () => {
    const accessRole = await service.createProductAccessRole(
      SUBJECT_ID as never,
      ORGANIZATION_ID,
      SCOPE.productId,
      { name: "Telemetry viewer", description: "", actions: ["telemetry.read"] },
    );
    const actorMembership = store.records.get(
      store.key("organization-membership", ORG_MEMBERSHIP_ID),
    )!.record as Extract<AuthRecord, { kind: "organization-membership" }>;
    store.seed({ ...actorMembership, role: "member" });

    await expect(
      service.createProductAccessRole(SUBJECT_ID as never, ORGANIZATION_ID, SCOPE.productId, {
        name: "Telemetry editor",
        description: "",
        actions: ["telemetry.write"],
      }),
    ).rejects.toThrow("You do not have permission to manage this product.");
    await expect(
      service.removeProductAccessRole(
        SUBJECT_ID as never,
        ORGANIZATION_ID,
        SCOPE.productId,
        accessRole.id,
      ),
    ).rejects.toThrow("You do not have permission to manage this product.");
  });

  it("snapshots role actions into grants and preserves them after role removal", async () => {
    const accessRole = await service.createProductAccessRole(
      SUBJECT_ID as never,
      ORGANIZATION_ID,
      SCOPE.productId,
      {
        name: "Telemetry viewer",
        description: "Read telemetry",
        actions: ["telemetry.read", "telemetry.events.read"],
      },
    );
    const grant = await service.createPermissionGrant(
      SUBJECT_ID as never,
      ROLE_TARGET_SUBJECT_ID,
      SCOPE,
      [],
      accessRole.id,
    );

    expect(grant).toMatchObject({
      accessRole: { id: accessRole.id, name: accessRole.name },
      grants: [{ actions: ["telemetry.read", "telemetry.events.read"] }],
    });

    await service.removeProductAccessRole(
      SUBJECT_ID as never,
      ORGANIZATION_ID,
      SCOPE.productId,
      accessRole.id,
    );
    const targetMembership = await store.readOrganizationMembership(
      ORGANIZATION_ID,
      ROLE_TARGET_SUBJECT_ID,
      SCOPE.productId,
    );
    expect(targetMembership?.permissionGrants).toContainEqual(grant);
    await expect(
      service.createPermissionGrant(
        SUBJECT_ID as never,
        ROLE_TARGET_SUBJECT_ID,
        SCOPE,
        [],
        accessRole.id,
      ),
    ).rejects.toThrow("Choose an access role configured for this product.");
  });
});

describe("product manager page access", () => {
  let requireProductManagerRole: (typeof import("../../src/lib/auth/product-page-context"))["requireProductManagerRole"];

  beforeEach(async () => {
    vi.resetModules();
    ({ requireProductManagerRole } = await import("../../src/lib/auth/product-page-context"));
  });

  it.each(["owner", "admin"] as const)("allows a product %s to manage access pages", (role) => {
    expect(requireProductManagerRole(role, ORGANIZATION_ID, SCOPE.productId)).toBe(role);
  });

  it("redirects product members away from manager-only pages", () => {
    expect(() => requireProductManagerRole("member", ORGANIZATION_ID, SCOPE.productId)).toThrow(
      `redirect:/dashboard/${ORGANIZATION_ID}/products/${SCOPE.productId}`,
    );
  });
});

describe("access grant role selector", () => {
  it("lists configured product roles alongside custom actions", () => {
    const role: ProductAccessRole = {
      id: "role-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Telemetry viewer",
      description: "Read telemetry events",
      actions: ["telemetry.read", "telemetry.events.read"],
    };

    const html = renderToStaticMarkup(createElement(AccessGrantActionsFields, { roles: [role] }));

    expect(html).toContain("Telemetry viewer");
    expect(html).toContain("Custom actions");
  });
});
