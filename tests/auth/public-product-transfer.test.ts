import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRecord } from "../../src/lib/auth/domain";
import {
  API_KEY_ID,
  MemoryStore,
  ORG_MEMBERSHIP_ID,
  ORGANIZATION_ID,
  ROLE_PRODUCT_RECORD_ID,
  ROLE_TARGET_SUBJECT_ID,
  SUBJECT_ID,
  seedAuthorizationData,
  TRANSFER_ADOPTER_CLIENT_ID,
  TRANSFER_ADOPTER_MEMBERSHIP_ID,
  TRANSFER_ADOPTER_ORG_ID,
  TRANSFER_ADOPTER_ORG_MEMBERSHIP_ID,
  TRANSFER_ADOPTER_PRODUCT_RECORD_ID,
  TRANSFER_DESTINATION_CLIENT_ID,
  TRANSFER_DESTINATION_MEMBERSHIP_ID,
  TRANSFER_DESTINATION_ORG_ID,
  TRANSFER_DESTINATION_PRODUCT_RECORD_ID,
} from "./helpers/memory-store";

const mocks = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/auth/storage/spaces", () => ({
  createSpacesAuthStoreFromEnv: () => mocks.store,
}));

describe("platform public product ownership transfer", () => {
  let store: MemoryStore;
  let service: typeof import("../../src/lib/auth/service");

  function seedOrganization(
    organizationId: string,
    name: string,
    approvalStatus: "approved" | "pending" = "approved",
  ) {
    const now = new Date().toISOString();
    store.seed({
      kind: "organization",
      schemaVersion: 1,
      organizationId: organizationId as never,
      name,
      approvalStatus,
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
  }

  function seedSourceProduct(visibility: "public" | "private" = "public") {
    const now = new Date().toISOString();
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: ROLE_PRODUCT_RECORD_ID as never,
      organizationId: ORGANIZATION_ID as never,
      productId: "atlas",
      name: "Atlas",
      description: "Shared access for Atlas.",
      websiteUrl: "https://atlas.example.com",
      iconUrl: "",
      visibility,
      accessRoles: [
        {
          id: `role-${"a".repeat(32)}`,
          name: "Project reader",
          description: "Read projects",
          actions: ["project.read"],
        },
      ],
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
  }

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

  it("includes adopter installations and explains destinations with pending or replaceable products", async () => {
    seedSourceProduct();
    seedOrganization(TRANSFER_DESTINATION_ORG_ID, "Destination Org");
    const conflictOrganizationId = "13131313-1313-4313-8313-131313131313";
    const pendingOrganizationId = "14141414-1414-4414-8414-141414141414";
    seedOrganization(conflictOrganizationId, "Conflict Org");
    seedOrganization(pendingOrganizationId, "Pending Org", "pending");
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: TRANSFER_DESTINATION_PRODUCT_RECORD_ID as never,
      organizationId: TRANSFER_DESTINATION_ORG_ID as never,
      productId: "atlas",
      name: "Atlas",
      description: "Shared access for Atlas.",
      websiteUrl: "https://atlas.example.com",
      iconUrl: "",
      visibility: "public",
      sharedProductRef: {
        sourceOrganizationId: ORGANIZATION_ID as never,
        sourceProductRecordId: ROLE_PRODUCT_RECORD_ID as never,
        sourceProductId: "atlas",
        detachedAt: null,
      },
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as AuthRecord);
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: "15151515-1515-4515-8515-151515151515" as never,
      organizationId: conflictOrganizationId as never,
      productId: "atlas",
      name: "Local Atlas",
      description: "",
      websiteUrl: "https://local-atlas.example.com",
      iconUrl: "",
      visibility: "private",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as AuthRecord);

    const products = await service.listPublicProductsForAdministrator(SUBJECT_ID as never);

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      product: { productRecordId: ROLE_PRODUCT_RECORD_ID, productId: "atlas" },
      publisherOrganizationName: "Legacy Organization",
    });
    expect(products[0].destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: TRANSFER_DESTINATION_ORG_ID,
          name: "Destination Org",
        }),
        expect.objectContaining({
          organizationId: conflictOrganizationId,
          name: "Conflict Org",
          transferNotice: "Existing product details will be replaced",
        }),
        expect.objectContaining({
          organizationId: pendingOrganizationId,
          name: "Pending Org",
          disabledReason: "Waiting for organization approval",
        }),
      ]),
    );
  });

  it("moves publisher ownership while preserving former publisher and adopter setup", async () => {
    seedSourceProduct();
    seedOrganization(TRANSFER_DESTINATION_ORG_ID, "Destination Org");
    seedOrganization(TRANSFER_ADOPTER_ORG_ID, "Adopter Org");
    const now = new Date().toISOString();
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: TRANSFER_DESTINATION_PRODUCT_RECORD_ID as never,
      organizationId: TRANSFER_DESTINATION_ORG_ID as never,
      productId: "atlas",
      name: "Atlas",
      description: "Shared access for Atlas.",
      websiteUrl: "https://atlas.example.com",
      iconUrl: "",
      visibility: "public",
      sharedProductRef: {
        sourceOrganizationId: ORGANIZATION_ID as never,
        sourceProductRecordId: ROLE_PRODUCT_RECORD_ID as never,
        sourceProductId: "atlas",
        detachedAt: null,
      },
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: TRANSFER_DESTINATION_MEMBERSHIP_ID as never,
      organizationId: TRANSFER_DESTINATION_ORG_ID as never,
      productId: "atlas",
      subjectId: ROLE_TARGET_SUBJECT_ID as never,
      role: "admin",
      status: "active",
      permissionGrants: [],
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "consumer-client",
      schemaVersion: 1,
      consumerClientId: TRANSFER_DESTINATION_CLIENT_ID as never,
      organizationId: TRANSFER_DESTINATION_ORG_ID as never,
      productId: "atlas",
      appName: "Destination app",
      appOrigin: "https://destination.example.com",
      sessionLifetimeMs: 60_000,
      selfRegistrationEnabled: false,
      verifier: { algorithm: "sha256", digestHex: "b".repeat(64) },
      status: "active",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: TRANSFER_ADOPTER_ORG_MEMBERSHIP_ID as never,
      organizationId: TRANSFER_ADOPTER_ORG_ID as never,
      subjectId: SUBJECT_ID as never,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: TRANSFER_ADOPTER_PRODUCT_RECORD_ID as never,
      organizationId: TRANSFER_ADOPTER_ORG_ID as never,
      productId: "atlas",
      name: "Atlas",
      description: "Shared access for Atlas.",
      websiteUrl: "https://atlas.example.com",
      iconUrl: "",
      visibility: "public",
      sharedProductRef: {
        sourceOrganizationId: ORGANIZATION_ID as never,
        sourceProductRecordId: ROLE_PRODUCT_RECORD_ID as never,
        sourceProductId: "atlas",
        detachedAt: null,
      },
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: TRANSFER_ADOPTER_MEMBERSHIP_ID as never,
      organizationId: TRANSFER_ADOPTER_ORG_ID as never,
      productId: "atlas",
      subjectId: ROLE_TARGET_SUBJECT_ID as never,
      role: "admin",
      status: "active",
      permissionGrants: [],
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "consumer-client",
      schemaVersion: 1,
      consumerClientId: TRANSFER_ADOPTER_CLIENT_ID as never,
      organizationId: TRANSFER_ADOPTER_ORG_ID as never,
      productId: "atlas",
      appName: "Atlas app",
      appOrigin: "https://atlas.example.com",
      sessionLifetimeMs: 60_000,
      selfRegistrationEnabled: false,
      verifier: { algorithm: "sha256", digestHex: "a".repeat(64) },
      status: "active",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    } as AuthRecord);
    const originalPublisherMembership = store.records.get(
      store.key("organization-membership", ORG_MEMBERSHIP_ID),
    )!.record;
    const originalPublisherKey = store.records.get(store.key("api-key", API_KEY_ID))!.record;
    const adopterMembership = store.records.get(
      store.key("organization-membership", TRANSFER_ADOPTER_MEMBERSHIP_ID),
    )!.record;
    const adopterClient = store.records.get(
      store.key("consumer-client", TRANSFER_ADOPTER_CLIENT_ID),
    )!.record;
    const destinationMembership = store.records.get(
      store.key("organization-membership", TRANSFER_DESTINATION_MEMBERSHIP_ID),
    )!.record;
    const destinationClient = store.records.get(
      store.key("consumer-client", TRANSFER_DESTINATION_CLIENT_ID),
    )!.record;

    const result = await service.transferPublicProductForAdministrator(
      SUBJECT_ID as never,
      ROLE_PRODUCT_RECORD_ID,
      TRANSFER_DESTINATION_ORG_ID,
    );

    const oldPublisherProduct = store.records.get(
      store.key("product", ROLE_PRODUCT_RECORD_ID),
    )!.record;
    const newPublisherProduct = store.records.get(
      store.key("product", result.product.productRecordId),
    )!.record;
    const updatedInstallation = store.records.get(
      store.key("product", TRANSFER_ADOPTER_PRODUCT_RECORD_ID),
    )!.record;

    expect(oldPublisherProduct).toMatchObject({
      kind: "product",
      organizationId: ORGANIZATION_ID,
      visibility: "private",
      productId: "atlas",
      accessRoles: [{ name: "Project reader" }],
    });
    expect(newPublisherProduct).toMatchObject({
      kind: "product",
      productRecordId: TRANSFER_DESTINATION_PRODUCT_RECORD_ID,
      organizationId: TRANSFER_DESTINATION_ORG_ID,
      visibility: "public",
      productId: "atlas",
      accessRoles: [{ name: "Project reader" }],
    });
    expect(newPublisherProduct).not.toHaveProperty("sharedProductRef");
    expect(updatedInstallation).toMatchObject({
      kind: "product",
      organizationId: TRANSFER_ADOPTER_ORG_ID,
      sharedProductRef: {
        sourceOrganizationId: TRANSFER_DESTINATION_ORG_ID,
        sourceProductRecordId: result.product.productRecordId,
        sourceProductId: "atlas",
        detachedAt: null,
      },
    });
    await expect(
      service.listPublicProductsForOrganization(SUBJECT_ID as never, TRANSFER_ADOPTER_ORG_ID),
    ).resolves.toEqual([
      expect.objectContaining({
        product: expect.objectContaining({
          organizationId: TRANSFER_DESTINATION_ORG_ID,
          productId: "atlas",
        }),
        status: "installed",
      }),
    ]);
    expect(
      store.records.get(store.key("organization-membership", ORG_MEMBERSHIP_ID))!.record,
    ).toEqual(originalPublisherMembership);
    expect(store.records.get(store.key("api-key", API_KEY_ID))!.record).toEqual(
      originalPublisherKey,
    );
    expect(
      store.records.get(store.key("organization-membership", TRANSFER_ADOPTER_MEMBERSHIP_ID))!
        .record,
    ).toEqual(adopterMembership);
    expect(
      store.records.get(store.key("consumer-client", TRANSFER_ADOPTER_CLIENT_ID))!.record,
    ).toEqual(adopterClient);
    expect(
      store.records.get(store.key("organization-membership", TRANSFER_DESTINATION_MEMBERSHIP_ID))!
        .record,
    ).toEqual(destinationMembership);
    expect(
      store.records.get(store.key("consumer-client", TRANSFER_DESTINATION_CLIENT_ID))!.record,
    ).toEqual(destinationClient);
    expect(store.writes.every((record) => record.kind === "product")).toBe(true);
    expect(result.affectedOrganizationIds).toEqual(
      expect.arrayContaining([
        ORGANIZATION_ID,
        TRANSFER_DESTINATION_ORG_ID,
        TRANSFER_ADOPTER_ORG_ID,
      ]),
    );

    const audit = await service.listPlatformAudit(SUBJECT_ID as never);
    expect(audit.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "product.transferred",
          organization: "Destination Org",
          details: expect.arrayContaining([
            {
              label: "Transfer",
              value: "Atlas transferred from Legacy Organization to Destination Org",
            },
          ]),
        }),
      ]),
    );
  });

  it("resumes an interrupted transfer into an existing shared installation", async () => {
    seedSourceProduct();
    seedOrganization(TRANSFER_DESTINATION_ORG_ID, "Destination Org");
    const now = new Date().toISOString();
    const source = store.records.get(store.key("product", ROLE_PRODUCT_RECORD_ID))!
      .record as Extract<AuthRecord, { kind: "product" }>;
    store.seed({
      ...source,
      visibility: "private",
    });
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: TRANSFER_DESTINATION_PRODUCT_RECORD_ID as never,
      organizationId: TRANSFER_DESTINATION_ORG_ID as never,
      productId: "atlas",
      name: "Atlas",
      description: "Shared access for Atlas.",
      websiteUrl: "https://atlas.example.com",
      iconUrl: "",
      visibility: "private",
      sharedProductRef: {
        sourceOrganizationId: ORGANIZATION_ID as never,
        sourceProductRecordId: ROLE_PRODUCT_RECORD_ID as never,
        sourceProductId: "atlas",
        detachedAt: null,
      },
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);

    const [pendingTransfer] = await service.listPublicProductsForAdministrator(SUBJECT_ID as never);
    expect(pendingTransfer).toMatchObject({
      product: { productRecordId: ROLE_PRODUCT_RECORD_ID, visibility: "private" },
      pendingDestinationOrganizationId: TRANSFER_DESTINATION_ORG_ID,
    });

    const result = await service.transferPublicProductForAdministrator(
      SUBJECT_ID as never,
      ROLE_PRODUCT_RECORD_ID,
      TRANSFER_DESTINATION_ORG_ID,
    );

    expect(result.product.productRecordId).toBe(TRANSFER_DESTINATION_PRODUCT_RECORD_ID);
    expect(
      store.records.get(store.key("product", TRANSFER_DESTINATION_PRODUCT_RECORD_ID))!.record,
    ).toMatchObject({
      organizationId: TRANSFER_DESTINATION_ORG_ID,
      visibility: "public",
      productId: "atlas",
    });
    expect(
      store.records.get(store.key("product", TRANSFER_DESTINATION_PRODUCT_RECORD_ID))!.record,
    ).not.toHaveProperty("sharedProductRef");
  });

  it("rejects non-administrators, non-public sources, and invalid destinations", async () => {
    seedSourceProduct();
    seedOrganization(TRANSFER_DESTINATION_ORG_ID, "Destination Org", "pending");

    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "");
    await expect(service.listPublicProductsForAdministrator(SUBJECT_ID as never)).rejects.toThrow(
      "Administrator access is required.",
    );
    await expect(
      service.transferPublicProductForAdministrator(
        SUBJECT_ID as never,
        ROLE_PRODUCT_RECORD_ID,
        TRANSFER_DESTINATION_ORG_ID,
      ),
    ).rejects.toThrow("Administrator access is required.");

    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "person@example.com");
    await expect(
      service.transferPublicProductForAdministrator(
        SUBJECT_ID as never,
        ROLE_PRODUCT_RECORD_ID,
        ORGANIZATION_ID,
      ),
    ).rejects.toThrow("Choose a different destination organization.");
    await expect(
      service.transferPublicProductForAdministrator(
        SUBJECT_ID as never,
        ROLE_PRODUCT_RECORD_ID,
        TRANSFER_DESTINATION_ORG_ID,
      ),
    ).rejects.toThrow("Choose an approved destination organization.");

    const privateProductId = "16161616-1616-4616-8616-161616161616";
    store.seed({
      ...(store.records.get(store.key("product", ROLE_PRODUCT_RECORD_ID))!.record as Extract<
        AuthRecord,
        { kind: "product" }
      >),
      productRecordId: privateProductId as never,
      productId: "private-atlas",
      visibility: "private",
    });
    await expect(
      service.transferPublicProductForAdministrator(
        SUBJECT_ID as never,
        privateProductId,
        TRANSFER_DESTINATION_ORG_ID,
      ),
    ).rejects.toThrow("Only a public publisher product can be transferred.");
  });

  it("replaces destination product details when the action targets an existing product ID", async () => {
    seedSourceProduct();
    seedOrganization(TRANSFER_DESTINATION_ORG_ID, "Destination Org");
    store.seed({
      kind: "product",
      schemaVersion: 1,
      productRecordId: "17171717-1717-4717-8717-171717171717" as never,
      organizationId: TRANSFER_DESTINATION_ORG_ID as never,
      productId: "atlas",
      name: "Destination Atlas",
      description: "",
      websiteUrl: "https://destination-atlas.example.com",
      iconUrl: "",
      visibility: "private",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as AuthRecord);

    const existingProductRecordId = "17171717-1717-4717-8717-171717171717";
    const result = await service.transferPublicProductForAdministrator(
      SUBJECT_ID as never,
      ROLE_PRODUCT_RECORD_ID,
      TRANSFER_DESTINATION_ORG_ID,
    );

    expect(result).toMatchObject({
      product: {
        productRecordId: existingProductRecordId,
        organizationId: TRANSFER_DESTINATION_ORG_ID,
        productId: "atlas",
        name: "Atlas",
        description: "Shared access for Atlas.",
        websiteUrl: "https://atlas.example.com",
        visibility: "public",
      },
      sourceOrganizationId: ORGANIZATION_ID,
      destinationOrganizationId: TRANSFER_DESTINATION_ORG_ID,
      affectedOrganizationIds: expect.arrayContaining([
        ORGANIZATION_ID,
        TRANSFER_DESTINATION_ORG_ID,
      ]),
    });
    expect(store.records.get(store.key("product", existingProductRecordId))?.record).toMatchObject({
      organizationId: TRANSFER_DESTINATION_ORG_ID,
      productId: "atlas",
      name: "Atlas",
      description: "Shared access for Atlas.",
      websiteUrl: "https://atlas.example.com",
      visibility: "public",
    });
    expect(store.records.get(store.key("product", ROLE_PRODUCT_RECORD_ID))?.record).toMatchObject({
      organizationId: ORGANIZATION_ID,
      visibility: "private",
    });
  });
});
