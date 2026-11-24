import { createHash, scryptSync } from "node:crypto";
import { hash as hashArgon2id } from "@node-rs/argon2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRecord } from "../../src/lib/auth/domain";
import {
  API_KEY_ID,
  CONSUMER_CLIENT_ID,
  MemoryStore,
  ORGANIZATION_ID,
  ROLE_PRODUCT_RECORD_ID,
  SUBJECT_ID,
  seedAuthorizationData,
  seedConsumerProductMembership,
} from "./helpers/memory-store";

const mocks = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/auth/storage/spaces", () => ({
  createSpacesAuthStoreFromEnv: () => mocks.store,
}));

describe("consumer identity migration and management", () => {
  let store: MemoryStore;
  let service: typeof import("../../src/lib/auth/service");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("PERMINISTER_ADMIN_EMAILS", "");
    store = new MemoryStore();
    seedAuthorizationData(store);
    for (const [index, productId] of ["workspaceapp", "projectapp"].entries()) {
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

  it("verifies and upgrades WorkspaceApp Argon2id and ProjectApp scrypt credentials", async () => {
    const password = "Legacy password long enough 7!";
    const now = new Date().toISOString();
    const argonHash = await hashArgon2id(password);
    const projectAppSalt = "0123456789abcdef0123456789abcdef";
    const projectAppHash = `${projectAppSalt}:${scryptSync(password, projectAppSalt, 64).toString("hex")}`;
    const workspaceappId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const projectAppId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    store.seed({
      kind: "subject",
      schemaVersion: 1,
      subjectId: workspaceappId as never,
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
      subjectId: projectAppId as never,
      status: "active",
      primaryEmail: null,
      emailVerifiedAt: null,
      emailVerificationExempt: true,
      loginIdentifiers: [
        { kind: "username", productId: "projectapp", value: "writer", normalizedValue: "writer" },
      ],
      passwordCredential: {
        algorithm: "scrypt",
        format: "legacy-scrypt-salt-hex-v1",
        encodedVerifier: projectAppHash,
        updatedAt: now,
      },
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    seedConsumerProductMembership(store, projectAppId, "projectapp");

    await expect(
      service.authenticate("argon@example.com", password, "workspaceapp"),
    ).resolves.toMatchObject({
      subjectId: workspaceappId,
    });
    await expect(service.authenticate("writer", password, "projectapp")).resolves.toMatchObject({
      subjectId: projectAppId,
    });
    expect(store.records.get(store.key("subject", workspaceappId))?.record).toMatchObject({
      passwordCredential: { algorithm: "scrypt", format: "perminister-scrypt-v1" },
    });
    expect(store.records.get(store.key("subject", projectAppId))?.record).toMatchObject({
      passwordCredential: { algorithm: "scrypt", format: "perminister-scrypt-v1" },
    });

    const session = await service.createConsumerSession(
      projectAppId as never,
      "projectapp",
      "projectapp",
      8 * 60 * 60 * 1000,
    );
    expect(Date.parse(session.session.expiresAt) - Date.parse(session.session.createdAt)).toBe(
      8 * 60 * 60 * 1000,
    );
    await expect(
      service.getConsumerSessionFromToken(session.token, "projectapp"),
    ).resolves.toMatchObject({ subject: { subjectId: projectAppId } });
  });

  it("supports verified identities from a customer-configured OIDC provider", async () => {
    const input = {
      provider: "oidc-0123456789ab",
      providerSubject: "identity-subject",
      email: "oidc-user@example.com",
      emailVerified: true,
      firstName: "OIDC",
      lastName: "User",
    };

    const created = await service.signInWithExternalIdentity(input);
    const signedIn = await service.signInWithExternalIdentity(input);

    expect(created.subjectId).toBe(signedIn.subjectId);
    expect(created).toMatchObject({
      primaryEmail: input.email,
      externalIdentities: [{ provider: input.provider, subject: input.providerSubject }],
    });
    await expect(
      service.signInWithExternalIdentity({ ...input, emailVerified: false }),
    ).rejects.toThrow("The identity provider did not return a verified account.");
  });

  it("binds one-time OIDC codes to the client, exact callback, PKCE verifier, and nonce", async () => {
    const now = new Date().toISOString();
    const callback = "https://postparticle.example/auth/perminister/callback";
    const verifier = "v".repeat(43);
    const nonce = "n".repeat(43);
    const scope = "openid profile email perminister_api";
    store.seed({
      kind: "consumer-client",
      schemaVersion: 1,
      consumerClientId: CONSUMER_CLIENT_ID as never,
      productId: "postparticle",
      appName: "PostParticle",
      appOrigin: "https://postparticle.example",
      sessionLifetimeMs: 60 * 60 * 1000,
      selfRegistrationEnabled: false,
      verifier: { algorithm: "sha256", digestHex: "a".repeat(64) },
      status: "active",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    } as AuthRecord);
    seedConsumerProductMembership(store, SUBJECT_ID, "postparticle");

    const code = await service.createConsumerAuthorizationCode(
      SUBJECT_ID as never,
      CONSUMER_CLIENT_ID,
      createHash("sha256").update(verifier).digest("base64url"),
      nonce,
      callback,
      scope,
    );

    await expect(
      service.exchangeConsumerAuthorizationCode(code, CONSUMER_CLIENT_ID, verifier, "https://postparticle.example/other"),
    ).rejects.toThrow("authorization code is invalid");
    await expect(
      service.exchangeConsumerAuthorizationCode(code, CONSUMER_CLIENT_ID, "x".repeat(43), callback),
    ).rejects.toThrow("authorization code is invalid");

    const exchanged = await service.exchangeConsumerAuthorizationCode(
      code,
      CONSUMER_CLIENT_ID,
      verifier,
      callback,
    );
    expect(exchanged).toMatchObject({ nonce, scope, productId: "postparticle" });
    expect(exchanged.session.applicationClientId).toBe(CONSUMER_CLIENT_ID);
    await expect(
      service.exchangeConsumerAuthorizationCode(code, CONSUMER_CLIENT_ID, verifier, callback),
    ).rejects.toThrow("authorization code is invalid");
  });

  it("exchanges a legacy code without OIDC claims or a callback parameter", async () => {
    const now = new Date().toISOString();
    const callback = "https://postparticle.example/auth/perminister/callback";
    const verifier = "v".repeat(43);
    store.seed({
      kind: "consumer-client",
      schemaVersion: 1,
      consumerClientId: CONSUMER_CLIENT_ID as never,
      productId: "postparticle",
      appName: "PostParticle",
      appOrigin: "https://postparticle.example",
      sessionLifetimeMs: 60 * 60 * 1000,
      selfRegistrationEnabled: false,
      verifier: { algorithm: "sha256", digestHex: "a".repeat(64) },
      status: "active",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    } as AuthRecord);
    seedConsumerProductMembership(store, SUBJECT_ID, "postparticle");

    const code = await service.createConsumerAuthorizationCode(
      SUBJECT_ID as never,
      CONSUMER_CLIENT_ID,
      createHash("sha256").update(verifier).digest("base64url"),
      null,
      callback,
      null,
    );

    const exchanged = await service.exchangeConsumerAuthorizationCode(
      code,
      CONSUMER_CLIENT_ID,
      verifier,
    );
    expect(exchanged).toMatchObject({ nonce: null, scope: null, productId: "postparticle" });
    expect(exchanged.session.applicationClientId).toBe(CONSUMER_CLIENT_ID);
    await expect(
      service.exchangeConsumerAuthorizationCode(code, CONSUMER_CLIENT_ID, verifier),
    ).rejects.toThrow("authorization code is invalid");
  });

  it("rejects expired OIDC authorization codes", async () => {
    const now = new Date().toISOString();
    const callback = "https://postparticle.example/auth/perminister/callback";
    const verifier = "v".repeat(43);
    store.seed({
      kind: "consumer-client",
      schemaVersion: 1,
      consumerClientId: CONSUMER_CLIENT_ID as never,
      productId: "postparticle",
      appName: "PostParticle",
      appOrigin: "https://postparticle.example",
      sessionLifetimeMs: 60 * 60 * 1000,
      selfRegistrationEnabled: false,
      verifier: { algorithm: "sha256", digestHex: "a".repeat(64) },
      status: "active",
      createdBySubjectId: SUBJECT_ID as never,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    } as AuthRecord);
    seedConsumerProductMembership(store, SUBJECT_ID, "postparticle");
    const code = await service.createConsumerAuthorizationCode(
      SUBJECT_ID as never,
      CONSUMER_CLIENT_ID,
      createHash("sha256").update(verifier).digest("base64url"),
      "n".repeat(43),
      callback,
      "openid profile email perminister_api",
    );
    const id = code.split(".")[0]!;
    const stored = store.records.get(store.key("consumer-authorization-code", id))!;
    store.seed({ ...stored.record, expiresAt: new Date(Date.now() - 1000).toISOString() } as AuthRecord);

    await expect(
      service.exchangeConsumerAuthorizationCode(code, CONSUMER_CLIENT_ID, verifier, callback),
    ).rejects.toThrow("authorization code is invalid");
  });

  it("keeps ProjectApp account disable and session revocation scoped to that product", async () => {
    const password = "Shared legacy password 123!";
    const now = new Date().toISOString();
    const adminId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    store.seed({
      kind: "subject",
      schemaVersion: 1,
      subjectId: adminId as never,
      status: "active",
      primaryEmail: "admin@example.com",
      emailVerifiedAt: now,
      loginIdentifiers: [
        {
          kind: "username",
          productId: "projectapp",
          value: "platformadmin",
          normalizedValue: "platformadmin",
        },
      ],
      passwordCredential: null,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: "ffffffff-ffff-4fff-8fff-ffffffffffff" as never,
      organizationId: ORGANIZATION_ID as never,
      productId: "projectapp",
      subjectId: adminId as never,
      role: "member",
      status: "active",
      permissionGrants: [
        {
          kind: "membership",
          schemaVersion: 1,
          membershipId: "12121212-1212-4121-8121-121212121212" as never,
          subjectId: adminId as never,
          scope: {
            kind: "product",
            organizationId: ORGANIZATION_ID as never,
            productId: "projectapp",
          },
          grants: [
            {
              scope: {
                kind: "product",
                organizationId: ORGANIZATION_ID as never,
                productId: "projectapp",
              },
              actions: [
                "projectapp:accounts:manage",
                "projectapp:members:manage",
                "projectapp:project:read",
                "projectapp:project:write",
              ],
            },
          ],
          accessRole: { id: "projectapp:product:platform-admin", name: "platform-admin" },
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: "13131313-1313-4131-8131-131313131313" as never,
      organizationId: ORGANIZATION_ID as never,
      subjectId: SUBJECT_ID as never,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    const workspaceId = "11111111-2222-4333-8444-555555555555";
    await service.bootstrapWorkspaceAdmin(
      SUBJECT_ID as never,
      "workspaceapp",
      ORGANIZATION_ID,
      workspaceId,
    );
    const provisionedWorkspace = await service.createConsumerMember(
      SUBJECT_ID as never,
      "workspaceapp",
      {
        organizationId: ORGANIZATION_ID,
        productId: "workspaceapp",
        scopeKind: "workspace",
        resourceId: workspaceId,
        email: "shared@example.com",
        password,
        role: "viewer",
      },
    );
    const sharedId = provisionedWorkspace.member.subjectId;
    seedConsumerProductMembership(store, sharedId, "projectapp");
    await service.createConsumerAccount(adminId as never, "projectapp", {
      organizationId: ORGANIZATION_ID,
      productId: "projectapp",
      username: "writer",
      email: "shared@example.com",
      password,
    });
    await service.updateConsumerAccount(adminId as never, "projectapp", sharedId, {
      organizationId: ORGANIZATION_ID,
      productId: "projectapp",
      status: "disabled",
    });
    expect(store.records.get(store.key("subject", sharedId))?.record).toMatchObject({
      status: "active",
      consumerProductStates: [{ productId: "projectapp", status: "disabled", sessionVersion: 2 }],
    });

    const workspaceappSession = await service.createConsumerSession(
      sharedId as never,
      "workspaceapp",
      "workspaceapp",
      30 * 24 * 60 * 60 * 1000,
    );
    await expect(
      service.authenticate("shared@example.com", password, "workspaceapp"),
    ).resolves.toMatchObject({
      subjectId: sharedId,
    });
    await expect(service.authenticate("writer", password, "projectapp")).rejects.toThrow(
      "Email or password is incorrect.",
    );
    await expect(
      service.createConsumerSession(sharedId as never, "projectapp", "projectapp"),
    ).rejects.toThrow("disabled for the application");

    await service.updateConsumerAccount(adminId as never, "projectapp", sharedId!, {
      organizationId: ORGANIZATION_ID,
      productId: "projectapp",
      status: "active",
    });
    const projectAppSession = await service.createConsumerSession(
      sharedId as never,
      "projectapp",
      "projectapp",
      8 * 60 * 60 * 1000,
    );
    await service.updateConsumerAccount(adminId as never, "projectapp", sharedId!, {
      organizationId: ORGANIZATION_ID,
      productId: "projectapp",
      revokeSessions: true,
    });
    await expect(
      service.getConsumerSessionFromToken(projectAppSession.token, "projectapp"),
    ).resolves.toBeNull();
    await expect(
      service.getConsumerSessionFromToken(workspaceappSession.token, "workspaceapp"),
    ).resolves.toBeTruthy();
  });

  it("keeps WorkspaceApp members workspace-scoped and protects the last active administrator", async () => {
    const now = new Date().toISOString();
    const actorId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    store.seed({
      kind: "subject",
      schemaVersion: 1,
      subjectId: actorId as never,
      status: "active",
      primaryEmail: "admin@example.com",
      emailVerifiedAt: now,
      passwordCredential: null,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: "13131313-1313-4131-8131-131313131313" as never,
      organizationId: ORGANIZATION_ID as never,
      subjectId: actorId as never,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    const workspaceId = "11111111-2222-4333-8444-555555555555";
    await service.bootstrapWorkspaceAdmin(
      actorId as never,
      "workspaceapp",
      ORGANIZATION_ID,
      workspaceId,
    );
    const viewerProvisioned = await service.createConsumerMember(actorId as never, "workspaceapp", {
      organizationId: ORGANIZATION_ID,
      productId: "workspaceapp",
      scopeKind: "workspace",
      resourceId: workspaceId,
      email: "viewer@example.com",
      password: "WorkspaceApp password 123!",
      role: "viewer",
    });
    const targetId = viewerProvisioned.member.subjectId;

    const viewerSession = await service.createConsumerSession(
      targetId as never,
      "workspaceapp",
      "workspaceapp",
    );
    await expect(
      service.authorizeApiKey(
        viewerSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "workspaceapp",
          resourceKind: "workspace",
          resourceId: workspaceId,
          action: "workspaceapp:workspace:read",
        },
        "workspaceapp",
      ),
    ).resolves.toMatchObject({ authorized: true });
    await expect(
      service.authorizeApiKey(
        viewerSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "workspaceapp",
          resourceKind: "workspace",
          resourceId: workspaceId,
          action: "workspaceapp:members:manage",
        },
        "workspaceapp",
      ),
    ).resolves.toMatchObject({ authorized: false });

    const targetBefore = store.records.get(store.key("subject", targetId!))?.record;
    const attached = await service.createConsumerMember(actorId as never, "workspaceapp", {
      organizationId: ORGANIZATION_ID,
      productId: "workspaceapp",
      scopeKind: "workspace",
      resourceId: workspaceId,
      email: "viewer@example.com",
      password: "Ignored because the account already exists 7!",
      role: "viewer",
    });
    expect(attached.created).toBe(false);
    expect(attached.member.subjectId).toBe(targetId);
    expect(store.records.get(store.key("subject", targetId!))?.record).toEqual(targetBefore);

    const members = await service.listConsumerMembers(actorId as never, "workspaceapp", {
      organizationId: ORGANIZATION_ID,
      productId: "workspaceapp",
      scopeKind: "workspace",
      resourceId: workspaceId,
    });
    expect(members).toHaveLength(2);
    await expect(
      service.listConsumerMembers(actorId as never, "workspaceapp", {
        organizationId: ORGANIZATION_ID,
        productId: "workspaceapp",
        scopeKind: "workspace",
        resourceId: "workspace-2",
      }),
    ).rejects.toThrow("permission");
    await expect(
      service.updateConsumerMember(actorId as never, "workspaceapp", actorId!, {
        organizationId: ORGANIZATION_ID,
        productId: "workspaceapp",
        scopeKind: "workspace",
        resourceId: workspaceId,
        role: "viewer",
      }),
    ).rejects.toThrow("another administrator");
    await expect(
      service.updateConsumerMember(actorId as never, "workspaceapp", targetId!, {
        organizationId: ORGANIZATION_ID,
        productId: "workspaceapp",
        scopeKind: "workspace",
        resourceId: workspaceId,
        role: "admin",
      }),
    ).resolves.toBeUndefined();
  });

  it("enforces ProjectApp project roles and platform-admin account controls", async () => {
    const password = "ProjectApp legacy password 123!";
    const now = new Date().toISOString();
    const platformAdminId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    store.seed({
      kind: "subject",
      schemaVersion: 1,
      subjectId: platformAdminId as never,
      status: "active",
      primaryEmail: "platform@example.com",
      emailVerifiedAt: now,
      loginIdentifiers: [
        {
          kind: "username",
          productId: "projectapp",
          value: "platformadmin",
          normalizedValue: "platformadmin",
        },
      ],
      passwordCredential: null,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    store.seed({
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: "ffffffff-ffff-4fff-8fff-ffffffffffff" as never,
      organizationId: ORGANIZATION_ID as never,
      productId: "projectapp",
      subjectId: platformAdminId as never,
      role: "member",
      status: "active",
      permissionGrants: [
        {
          kind: "membership",
          schemaVersion: 1,
          membershipId: "12121212-1212-4121-8121-121212121212" as never,
          subjectId: platformAdminId as never,
          scope: {
            kind: "product",
            organizationId: ORGANIZATION_ID as never,
            productId: "projectapp",
          },
          grants: [
            {
              scope: {
                kind: "product",
                organizationId: ORGANIZATION_ID as never,
                productId: "projectapp",
              },
              actions: [
                "projectapp:accounts:manage",
                "projectapp:members:manage",
                "projectapp:project:read",
                "projectapp:project:write",
              ],
            },
          ],
          accessRole: { id: "projectapp:product:platform-admin", name: "platform-admin" },
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    } as AuthRecord);
    const projectAdminCreated = await service.createConsumerMember(
      platformAdminId as never,
      "projectapp",
      {
        organizationId: ORGANIZATION_ID,
        productId: "projectapp",
        scopeKind: "project",
        resourceId: "project-1",
        username: "projectadmin",
        email: "projectadmin@example.com",
        password,
        role: "admin",
      },
    );
    const writerCreated = await service.createConsumerMember(
      platformAdminId as never,
      "projectapp",
      {
        organizationId: ORGANIZATION_ID,
        productId: "projectapp",
        scopeKind: "project",
        resourceId: "project-1",
        username: "writer",
        password,
        role: "editor",
      },
    );
    const projectAdminId = projectAdminCreated.member.subjectId;
    const writerId = writerCreated.member.subjectId;

    const editorSession = await service.createConsumerSession(
      writerId as never,
      "projectapp",
      "projectapp",
    );
    await expect(
      service.authorizeApiKey(
        editorSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "projectapp",
          resourceKind: "project",
          resourceId: "project-1",
          action: "projectapp:project:write",
        },
        "projectapp",
      ),
    ).resolves.toMatchObject({ authorized: true });
    await expect(
      service.authorizeApiKey(
        editorSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "projectapp",
          resourceKind: "project",
          resourceId: "project-1",
          action: "projectapp:members:manage",
        },
        "projectapp",
      ),
    ).resolves.toMatchObject({ authorized: false });
    const platformSession = await service.createConsumerSession(
      platformAdminId as never,
      "projectapp",
      "projectapp",
    );
    await expect(
      service.authorizeApiKey(
        platformSession.token,
        {
          organizationId: ORGANIZATION_ID,
          productId: "projectapp",
          resourceKind: "product",
          action: "projectapp:accounts:manage",
        },
        "projectapp",
      ),
    ).resolves.toMatchObject({ authorized: true });

    const listed = await service.listConsumerMembers(platformAdminId as never, "projectapp", {
      organizationId: ORGANIZATION_ID,
      productId: "projectapp",
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
      service.listConsumerMembers(projectAdminId as never, "projectapp", {
        organizationId: ORGANIZATION_ID,
        productId: "projectapp",
        scopeKind: "project",
        resourceId: "project-2",
      }),
    ).rejects.toThrow("permission");
    await expect(
      service.listConsumerAccounts(
        projectAdminId as never,
        "projectapp",
        ORGANIZATION_ID,
        "projectapp",
      ),
    ).rejects.toThrow("Platform administrator");

    const accounts = await service.listConsumerAccounts(
      platformAdminId as never,
      "projectapp",
      ORGANIZATION_ID,
      "projectapp",
    );
    expect(accounts).toHaveLength(3);
    const addedPlatformAdmin = await service.createConsumerAccount(
      platformAdminId as never,
      "projectapp",
      {
        organizationId: ORGANIZATION_ID,
        productId: "projectapp",
        username: "additional-admin",
        password: "Another ProjectApp password 123!",
        platformAdmin: true,
      },
    );
    expect(addedPlatformAdmin).toMatchObject({
      created: true,
      account: { username: "additional-admin", platformAdmin: true },
    });
    await service.updateConsumerAccount(
      platformAdminId as never,
      "projectapp",
      addedPlatformAdmin.account.subjectId,
      {
        organizationId: ORGANIZATION_ID,
        productId: "projectapp",
        platformAdmin: false,
      },
    );
    const updatedPlatformAdmins = await service.listConsumerAccounts(
      platformAdminId as never,
      "projectapp",
      ORGANIZATION_ID,
      "projectapp",
    );
    expect(
      updatedPlatformAdmins.find((account) => account.username === "additional-admin")
        ?.platformAdmin,
    ).toBe(false);
    const created = await service.createConsumerMember(platformAdminId as never, "projectapp", {
      organizationId: ORGANIZATION_ID,
      productId: "projectapp",
      scopeKind: "project",
      resourceId: "project-2",
      username: "new-writer",
      password: "New ProjectApp password 123!",
      role: "viewer",
    });
    expect(created).toMatchObject({ created: true, member: { role: "viewer", active: true } });

    const clientSecret = "p".repeat(40);
    const clientNow = new Date().toISOString();
    store.seed({
      kind: "consumer-client",
      schemaVersion: 1,
      consumerClientId: CONSUMER_CLIENT_ID as never,
      productId: "projectapp",
      appName: "ProjectApp",
      appOrigin: null,
      sessionLifetimeMs: 8 * 60 * 60 * 1000,
      selfRegistrationEnabled: false,
      verifier: {
        algorithm: "sha256",
        digestHex: createHash("sha256").update(clientSecret).digest("hex"),
      },
      status: "active",
      createdBySubjectId: platformAdminId as never,
      createdAt: clientNow,
      updatedAt: clientNow,
      revokedAt: null,
    } as AuthRecord);
    const writerSession = await service.createConsumerSession(
      writerId as never,
      CONSUMER_CLIENT_ID,
      "projectapp",
      8 * 60 * 60 * 1000,
    );
    await expect(
      service.getConsumerSessionFromToken(writerSession.token, CONSUMER_CLIENT_ID),
    ).resolves.toBeTruthy();
    const { consumerRequestContext } = await import("../../src/lib/auth/consumer-route");
    const validHeaders = {
      "x-perminister-client-id": CONSUMER_CLIENT_ID,
      "x-perminister-client-secret": clientSecret,
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
      service.getConsumerSessionFromToken(writerSession.token, CONSUMER_CLIENT_ID),
    ).resolves.toBeNull();

    const resetSession = await service.createConsumerSession(
      writerId as never,
      CONSUMER_CLIENT_ID,
      "projectapp",
      8 * 60 * 60 * 1000,
    );
    await service.updateConsumerMember(platformAdminId as never, "projectapp", writerId!, {
      organizationId: ORGANIZATION_ID,
      productId: "projectapp",
      scopeKind: "project",
      resourceId: "project-1",
      role: "viewer",
      password: "Reset ProjectApp password 456!",
    });
    await expect(
      service.getConsumerSessionFromToken(resetSession.token, CONSUMER_CLIENT_ID),
    ).resolves.toBeNull();

    const secondSession = await service.createConsumerSession(
      writerId as never,
      CONSUMER_CLIENT_ID,
      "projectapp",
      8 * 60 * 60 * 1000,
    );
    await service.updateConsumerAccount(platformAdminId as never, "projectapp", writerId!, {
      organizationId: ORGANIZATION_ID,
      productId: "projectapp",
      status: "disabled",
    });
    await expect(
      service.getConsumerSessionFromToken(secondSession.token, CONSUMER_CLIENT_ID),
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
