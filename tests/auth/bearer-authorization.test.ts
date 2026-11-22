import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRecord } from "../../src/lib/auth/domain";
import {
  API_KEY_ID,
  GRANT_ID,
  INVITATION_ID,
  INVITATION_PRODUCT_RECORD_ID,
  MemoryStore,
  ORG_ADMIN_MEMBERSHIP_ID,
  ORG_MEMBERSHIP_ID,
  ORGANIZATION_ID,
  ROLE_TARGET_MEMBERSHIP_ID,
  ROLE_TARGET_SUBJECT_ID,
  AUTHORIZATION_REQUEST as request,
  SCOPE,
  SUBJECT_ID,
  seedAuthorizationData,
  TOKEN,
  WORKSPACE_APP_PRODUCT_RECORD_ID,
  WORKSPACE_APP_WORKSPACE_ID,
} from "./helpers/memory-store";

const mocks = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/auth/storage/spaces", () => ({
  createSpacesAuthStoreFromEnv: () => mocks.store,
}));

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

    const now = new Date().toISOString();
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: INVITATION_PRODUCT_RECORD_ID as never,
      organizationId: ORGANIZATION_ID as never,
      productId: SCOPE.productId,
      name: "Atlas",
      description: "",
      websiteUrl: "https://atlas.example.com",
      iconUrl: "",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);

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

  it("releases a sign-in reservation when lookup fails without locking later attempts", async () => {
    const findSubjectIdByEmail = store.findSubjectIdByEmail.bind(store);
    store.findSubjectIdByEmail = async () => {
      throw new Error("Spaces unavailable");
    };

    await expect(service.authenticate("person@example.com", "wrong-password")).rejects.toThrow(
      "Spaces unavailable",
    );

    store.findSubjectIdByEmail = findSubjectIdByEmail;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.authenticate("person@example.com", "wrong-password")).rejects.toThrow(
        "Email or password is incorrect.",
      );
    }
    await expect(service.authenticate("person@example.com", "wrong-password")).rejects.toThrow(
      "Email or password is incorrect.",
    );
  });
});

describe("WorkspaceApp workspace lifecycle grants", () => {
  let store: MemoryStore;
  let service: typeof import("../../src/lib/auth/service");

  beforeEach(async () => {
    vi.resetModules();
    store = new MemoryStore();
    seedAuthorizationData(store);
    const now = new Date().toISOString();
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: WORKSPACE_APP_PRODUCT_RECORD_ID as never,
      organizationId: ORGANIZATION_ID as never,
      productId: "workspaceapp",
      name: "WorkspaceApp",
      description: "",
      websiteUrl: "https://workspaceapp.example",
      iconUrl: "",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: ORG_ADMIN_MEMBERSHIP_ID as never,
      organizationId: ORGANIZATION_ID as never,
      subjectId: SUBJECT_ID as never,
      role: "admin",
      status: "active",
      permissionGrants: [],
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
      productId: "workspaceapp",
      subjectId: ROLE_TARGET_SUBJECT_ID as never,
      role: "member",
      status: "active",
      permissionGrants: [],
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    mocks.store = store;
    service = await import("../../src/lib/auth/service");
  });

  it("lets an organization admin bootstrap their own admin grant idempotently", async () => {
    await service.bootstrapWorkspaceAdmin(
      SUBJECT_ID as never,
      "workspaceapp",
      ORGANIZATION_ID,
      WORKSPACE_APP_WORKSPACE_ID,
    );
    await service.bootstrapWorkspaceAdmin(
      SUBJECT_ID as never,
      "workspaceapp",
      ORGANIZATION_ID,
      WORKSPACE_APP_WORKSPACE_ID,
    );

    const membership = await store.readOrganizationMembership(
      ORGANIZATION_ID,
      SUBJECT_ID as never,
      "workspaceapp",
    );
    expect(membership?.permissionGrants).toHaveLength(1);
    expect(membership?.permissionGrants?.[0]).toMatchObject({
      scope: {
        kind: "workspace",
        organizationId: ORGANIZATION_ID,
        productId: "workspaceapp",
        workspaceId: WORKSPACE_APP_WORKSPACE_ID,
      },
      accessRole: { name: "admin" },
      status: "active",
      grants: [
        {
          actions: ["workspaceapp:workspace:read", "workspaceapp:members:manage"],
        },
      ],
    });
  });

  it("rejects regular organization members from bootstrapping a project", async () => {
    const membership = store.records.get(
      store.key("organization-membership", ORG_ADMIN_MEMBERSHIP_ID),
    )!.record as Extract<AuthRecord, { kind: "organization-membership" }>;
    store.seed({ ...membership, role: "member" });

    await expect(
      service.bootstrapWorkspaceAdmin(
        SUBJECT_ID as never,
        "workspaceapp",
        ORGANIZATION_ID,
        WORKSPACE_APP_WORKSPACE_ID,
      ),
    ).rejects.toThrow("You do not have permission to manage this organization.");
    await expect(
      store.readOrganizationMembership(ORGANIZATION_ID, SUBJECT_ID as never, "workspaceapp"),
    ).resolves.toBeNull();
  });

  it("revokes all workspace grants for organization admins and is safe to retry", async () => {
    await service.bootstrapWorkspaceAdmin(
      SUBJECT_ID as never,
      "workspaceapp",
      ORGANIZATION_ID,
      WORKSPACE_APP_WORKSPACE_ID,
    );
    await service.createConsumerMember(SUBJECT_ID as never, "workspaceapp", {
      organizationId: ORGANIZATION_ID,
      productId: "workspaceapp",
      scopeKind: "workspace",
      resourceId: WORKSPACE_APP_WORKSPACE_ID,
      email: "member@example.com",
      role: "viewer",
    });

    await service.revokeWorkspaceGrants(
      SUBJECT_ID as never,
      "workspaceapp",
      ORGANIZATION_ID,
      WORKSPACE_APP_WORKSPACE_ID,
    );
    await service.revokeWorkspaceGrants(
      SUBJECT_ID as never,
      "workspaceapp",
      ORGANIZATION_ID,
      WORKSPACE_APP_WORKSPACE_ID,
    );

    for (const subjectId of [SUBJECT_ID, ROLE_TARGET_SUBJECT_ID]) {
      const membership = await store.readOrganizationMembership(
        ORGANIZATION_ID,
        subjectId as never,
        "workspaceapp",
      );
      expect(
        membership?.permissionGrants?.find(
          (grant) =>
            grant.scope.kind === "workspace" &&
            grant.scope.workspaceId === WORKSPACE_APP_WORKSPACE_ID,
        )?.status,
      ).toBe("disabled");
    }
  });
});
