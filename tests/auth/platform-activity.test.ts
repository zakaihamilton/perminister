import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRecord } from "../../src/lib/auth/domain";
import {
  API_KEY_ID,
  INVITATION_ID,
  MemoryStore,
  ORG_ADMIN_MEMBERSHIP_ID,
  ORGANIZATION_ID,
  ROLE_TARGET_MEMBERSHIP_ID,
  ROLE_TARGET_SUBJECT_ID,
  SUBJECT_ID,
  seedAuditEvents,
  seedAuthorizationData,
} from "./helpers/memory-store";

const mocks = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/auth/storage/spaces", () => ({
  createSpacesAuthStoreFromEnv: () => mocks.store,
}));

describe("platform activity pagination", () => {
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([0, 1, 25, 26, 100, 101])(
    "paginates %i events in newest-first 25-event pages, capped at 100",
    async (count) => {
      seedAuditEvents(store, count);

      const firstPage = await service.listPlatformAudit(SUBJECT_ID as never);
      const expectedItems = Math.min(count, 100);

      expect(firstPage).toMatchObject({
        page: 1,
        pageSize: 25,
        totalItems: expectedItems,
        totalPages: Math.ceil(expectedItems / 25),
      });
      expect(firstPage.entries.map((entry) => entry.type)).toEqual(
        Array.from({ length: Math.min(expectedItems, 25) }, (_, index) => `audit.${index}`),
      );
      expect(firstPage.entries).toHaveLength(Math.min(expectedItems, 25));
    },
  );

  it("clamps requests to the final page and normalizes invalid page numbers", async () => {
    seedAuditEvents(store, 101);

    const finalPage = await service.listPlatformAudit(SUBJECT_ID as never, 999);
    expect(finalPage).toMatchObject({ page: 4, totalItems: 100, totalPages: 4 });
    expect(finalPage.entries.map((entry) => entry.type)).toEqual(
      Array.from({ length: 25 }, (_, index) => `audit.${index + 75}`),
    );
    await expect(service.listPlatformAudit(SUBJECT_ID as never, 0)).resolves.toMatchObject({
      page: 1,
    });
    await expect(service.listPlatformAudit(SUBJECT_ID as never, 1.5)).resolves.toMatchObject({
      page: 1,
    });
  });

  it("resolves the organization, involved user, and distinct actor for each event", async () => {
    const now = new Date().toISOString();
    store.seed({
      kind: "subject",
      schemaVersion: 1,
      subjectId: ROLE_TARGET_SUBJECT_ID as never,
      status: "active",
      firstName: "Member",
      lastName: "Example",
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
      subjectId: ROLE_TARGET_SUBJECT_ID as never,
      role: "member",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: ORG_ADMIN_MEMBERSHIP_ID as never,
      organizationId: ORGANIZATION_ID as never,
      subjectId: SUBJECT_ID as never,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    await service.updateOrganizationMemberRole(
      SUBJECT_ID as never,
      ORGANIZATION_ID,
      ROLE_TARGET_MEMBERSHIP_ID,
      "admin",
    );

    const page = await service.listPlatformAudit(SUBJECT_ID as never);

    expect(page.entries[0]).toMatchObject({
      organization: "Legacy Organization",
      user: "Member Example (member@example.com)",
      actor: "person@example.com",
      summary: "Changed an organization member role",
      target: "Member Example (member@example.com)",
      details: expect.arrayContaining([{ label: "Role", before: "member", after: "admin" }]),
    });
  });

  it("shows only allowlisted API-key and invitation details", async () => {
    const now = new Date().toISOString();
    store.events.push(
      {
        schemaVersion: 1,
        eventId: "eeeeeeee-eeee-4eee-8eee-fffffffffff1" as never,
        aggregate: { kind: "api-key", id: API_KEY_ID as never },
        aggregateVersion: 1,
        occurredAt: now,
        actor: { kind: "subject", subjectId: SUBJECT_ID as never },
        type: "api-key.created",
        payload: {
          organizationId: ORGANIZATION_ID,
          subjectId: SUBJECT_ID,
          keyClass: "integration",
          expiresAt: null,
          changes: [{ field: "actions", before: [], after: ["project.read"] }],
          token: "must-not-be-rendered",
        },
      },
      {
        schemaVersion: 1,
        eventId: "eeeeeeee-eeee-4eee-8eee-fffffffffff2" as never,
        aggregate: { kind: "organization-invitation", id: INVITATION_ID as never },
        aggregateVersion: 1,
        occurredAt: now,
        actor: { kind: "subject", subjectId: SUBJECT_ID as never },
        type: "product.invitation-created",
        payload: {
          organizationId: ORGANIZATION_ID,
          invitationRole: "member",
          invitationExpiresAt: "2026-10-20T10:00:00.000Z",
          email: "private@example.com",
          token: "must-not-be-rendered",
        },
      },
    );

    const page = await service.listPlatformAudit(SUBJECT_ID as never);
    const keyEntry = page.entries.find((entry) => entry.type === "api-key.created");
    const invitationEntry = page.entries.find(
      (entry) => entry.type === "product.invitation-created",
    );

    expect(keyEntry).toMatchObject({
      summary: "Created an API key",
      target: "integration API key",
      details: expect.arrayContaining([
        { label: "Key type", value: "integration" },
        { label: "Allowed actions", before: "None", after: "project.read" },
      ]),
    });
    expect(invitationEntry).toMatchObject({
      target: "Product invitation",
      details: expect.arrayContaining([
        { label: "Invitation role", value: "member" },
        { label: "Invitation expires", value: "2026-10-20T10:00:00.000Z" },
      ]),
    });
    expect(JSON.stringify([keyEntry, invitationEntry])).not.toContain("must-not-be-rendered");
    expect(JSON.stringify([keyEntry, invitationEntry])).not.toContain("private@example.com");
  });

  it("keeps older events useful without inventing before-and-after values", async () => {
    seedAuditEvents(store, 1);

    const page = await service.listPlatformAudit(SUBJECT_ID as never);

    expect(page.entries[0]).toMatchObject({
      summary: "Audit · 0",
      details: [{ label: "Event type", value: "audit.0" }],
    });
    expect(page.entries[0].details.some((detail) => detail.before || detail.after)).toBe(false);
  });

  it("requires platform administrator access", async () => {
    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "");

    await expect(service.listPlatformAudit(SUBJECT_ID as never)).rejects.toThrow(
      "Administrator access is required.",
    );
  });
});
