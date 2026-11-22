import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessGrantActionsFields } from "../../src/components/access-grant-actions-fields";
import type { ProductAccessRole } from "../../src/lib/auth/access-roles";
import type { AuthRecord } from "../../src/lib/auth/domain";
import {
  MemoryStore,
  ORG_MEMBERSHIP_ID,
  ORGANIZATION_ID,
  ROLE_TARGET_MEMBERSHIP_ID,
  ROLE_TARGET_SUBJECT_ID,
  SCOPE,
  SUBJECT_ID,
  seedAuthorizationData,
  seedProductAccessRoleFixture,
} from "./helpers/memory-store";

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

  it("uses display names without exposing emails in product activity", async () => {
    const now = new Date().toISOString();
    store.seed({
      kind: "subject",
      schemaVersion: 1,
      subjectId: SUBJECT_ID as never,
      status: "active",
      firstName: "Admin",
      lastName: "Example",
      primaryEmail: "person@example.com",
      emailVerifiedAt: now,
      passwordCredential: null,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
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
      productId: SCOPE.productId,
      subjectId: ROLE_TARGET_SUBJECT_ID as never,
      role: "member",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.events.push({
      schemaVersion: 1,
      eventId: "eeeeeeee-eeee-4eee-8eee-ffffffffffff" as never,
      aggregate: { kind: "organization-membership", id: ROLE_TARGET_MEMBERSHIP_ID as never },
      aggregateVersion: 1,
      occurredAt: now,
      actor: { kind: "subject", subjectId: SUBJECT_ID as never },
      type: "product.member-role-updated",
      payload: {
        organizationId: ORGANIZATION_ID,
        productId: SCOPE.productId,
        subjectId: ROLE_TARGET_SUBJECT_ID,
      },
    });

    const entries = await service.listProductAudit(
      SUBJECT_ID as never,
      ORGANIZATION_ID,
      SCOPE.productId,
    );

    expect(entries[0]).toMatchObject({
      summary: "Changed a product member role",
      actor: "Admin Example",
      affectedUser: "Member Example",
      target: "Member Example",
    });
    expect(JSON.stringify(entries)).not.toContain("@example.com");
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
    expect(
      store.events.find((event) => event.type === "permission.granted")?.payload,
    ).toMatchObject({
      accessRoleName: "Telemetry viewer",
      changes: [
        {
          field: "actions",
          before: [],
          after: ["telemetry.read", "telemetry.events.read"],
        },
      ],
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

  it("records safe invitation details without the address or token", async () => {
    const { invitation, token } = await service.createProductInvitation(
      SUBJECT_ID as never,
      ORGANIZATION_ID,
      SCOPE.productId,
      "invitee@example.com",
      "member",
    );
    const event = store.events.find((item) => item.type === "product.invitation-created");

    expect(event?.payload).toMatchObject({
      invitationRole: "member",
      invitationExpiresAt: invitation.expiresAt,
    });
    expect(JSON.stringify(event)).not.toContain("invitee@example.com");
    expect(JSON.stringify(event)).not.toContain(token);
  });

  it("records safe API-key details without the generated key", async () => {
    const { record, token } = await service.createApiKeyForSubject(SUBJECT_ID as never, {
      scope: SCOPE,
      actions: ["project.read"],
      expiresAt: null,
    });
    const event = store.events.find((item) => item.aggregate.id === record.apiKeyId);

    expect(event?.payload).toMatchObject({
      keyClass: record.keyClass,
      changes: [{ field: "actions", before: [], after: ["project.read"] }],
    });
    expect(JSON.stringify(event)).not.toContain(token);
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

    const html = renderToStaticMarkup(
      createElement(AccessGrantActionsFields, { roles: [role], scopeKind: "" }),
    );

    expect(html).toContain("Telemetry viewer");
    expect(html).toContain("Custom permissions");
  });
});
