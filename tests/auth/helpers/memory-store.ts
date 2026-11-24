import { createHash } from "node:crypto";
import type {
  AuthEvent,
  AuthRecord,
  AuthRecordKind,
  ResourceScope,
} from "../../../src/lib/auth/domain";

export const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
export const SUBJECT_ID = "33333333-3333-4333-8333-333333333333";
export const API_KEY_ID = "55555555-5555-4555-8555-555555555555";
export const CONSUMER_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const ORG_MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";
export const GRANT_ID = "77777777-7777-4777-8777-777777777777";
export const ORG_ADMIN_MEMBERSHIP_ID = "23232323-2323-4323-8323-232323232323";
export const WORKSPACE_APP_PRODUCT_RECORD_ID = "24242424-2424-4424-8424-242424242424";
export const WORKSPACE_APP_WORKSPACE_ID = "25252525-2525-4525-8525-252525252525";
export const INVITATION_ID = "88888888-8888-4888-8888-888888888888";
export const INVITATION_PRODUCT_RECORD_ID = "34343434-3434-4434-8434-343434343434";
export const ROLE_PRODUCT_RECORD_ID = "99999999-9999-4999-8999-999999999999";
export const ROLE_TARGET_SUBJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ROLE_TARGET_MEMBERSHIP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const TRANSFER_DESTINATION_ORG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const TRANSFER_DESTINATION_PRODUCT_RECORD_ID = "19191919-1919-4919-8919-191919191919";
export const TRANSFER_DESTINATION_MEMBERSHIP_ID = "20202020-2020-4020-8020-202020202020";
export const TRANSFER_DESTINATION_CLIENT_ID = "21212121-2121-4121-8121-212121212121";
export const TRANSFER_ADOPTER_ORG_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const TRANSFER_ADOPTER_MEMBERSHIP_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const TRANSFER_ADOPTER_CLIENT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
export const TRANSFER_ADOPTER_PRODUCT_RECORD_ID = "12121212-1212-4212-8212-121212121212";
export const TRANSFER_ADOPTER_ORG_MEMBERSHIP_ID = "18181818-1818-4818-8818-181818181818";
const PRODUCT_ENTITLEMENT_MEMBERSHIP_ID = "15151515-1515-4515-8515-151515151515";

export const TOKEN = `pmk_${API_KEY_ID}_${"a".repeat(43)}`;
export const SCOPE: ResourceScope = {
  kind: "product",
  organizationId: ORGANIZATION_ID as ResourceScope["organizationId"],
  productId: "atlas",
};
export const AUTHORIZATION_REQUEST = {
  organizationId: ORGANIZATION_ID,
  productId: "atlas",
  resourceKind: "project" as const,
  resourceId: "billing",
  action: "project.read",
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
    case "consumer-client":
      return record.consumerClientId;
    case "oauth-client-registration":
      return record.oauthClientId;
    case "consumer-authorization-code":
      return record.consumerAuthorizationCodeId;
    case "session":
      return record.sessionId;
    case "email-action":
      return record.actionId;
  }
}

export class MemoryStore {
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

  async findSubjectIdByExternalIdentity(provider: string, providerSubject: string) {
    this.objectReads += 1;
    return (
      [...this.records.values()]
        .map((value) => value.record)
        .find(
          (record): record is Extract<AuthRecord, { kind: "subject" }> =>
            record.kind === "subject" &&
            record.externalIdentities?.some(
              (identity) => identity.provider === provider && identity.subject === providerSubject,
            ) === true,
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

  async listOrganizationEvents(organizationId: string, productId?: string) {
    return this.events.filter((event) => {
      const eventOrganizationId =
        typeof event.payload.organizationId === "string"
          ? event.payload.organizationId
          : event.aggregate.kind === "organization"
            ? event.aggregate.id
            : null;
      const eventProductId =
        typeof event.payload.productId === "string" ? event.payload.productId : null;
      return (
        eventOrganizationId === organizationId &&
        (productId === undefined || eventProductId === productId)
      );
    });
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

export function seedAuthorizationData(store: MemoryStore) {
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

export function seedConsumerProductMembership(
  store: MemoryStore,
  subjectId: string,
  productId: string,
) {
  const now = new Date().toISOString();
  store.seed({
    kind: "organization-membership",
    schemaVersion: 1,
    organizationMembershipId: PRODUCT_ENTITLEMENT_MEMBERSHIP_ID as never,
    organizationId: ORGANIZATION_ID as never,
    productId,
    subjectId: subjectId as never,
    role: "member",
    status: "active",
    permissionGrants: [],
    createdAt: now,
    updatedAt: now,
  } as AuthRecord);
}

export function seedAuditEvents(store: MemoryStore, count: number) {
  for (let index = 0; index < count; index += 1) {
    store.events.push({
      schemaVersion: 1,
      eventId: `eeeeeeee-eeee-4eee-8eee-${index.toString(16).padStart(12, "0")}` as never,
      aggregate: { kind: "organization", id: ORGANIZATION_ID as never },
      aggregateVersion: index + 1,
      occurredAt: new Date(Date.UTC(2026, 0, 1) + (count - index) * 60_000).toISOString(),
      actor: { kind: "system" },
      type: `audit.${index}`,
      payload: { index },
    });
  }
}

export function seedProductAccessRoleFixture(store: MemoryStore) {
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
