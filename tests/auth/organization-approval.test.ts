import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryStore,
  SCOPE,
  SUBJECT_ID,
  seedAuthorizationData,
} from "./helpers/memory-store";

const mocks = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/auth/storage/spaces", () => ({
  createSpacesAuthStoreFromEnv: () => mocks.store,
}));

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
