import {
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationMembershipRecord, SubjectRecord } from "../../src/lib/auth/domain";
import { newEventId, newOrganizationId, newOrganizationMembershipId, newSubjectId } from "../../src/lib/auth/domain";
import { SpacesAuthStore } from "../../src/lib/auth/storage/spaces";

vi.mock("server-only", () => ({}));

describe("v2 Spaces object layout", () => {
  it("writes direct ID-keyed JSON documents and HMAC email indexes", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new SpacesAuthStore({
      client: { send } as unknown as S3Client,
      bucket: "perminister",
      identityIndexSecret: "i".repeat(32),
    });
    const now = new Date().toISOString();
    const subject: SubjectRecord = {
      kind: "subject",
      schemaVersion: 1,
      subjectId: newSubjectId(),
      status: "active",
      primaryEmail: "person@example.com",
      emailVerifiedAt: now,
      passwordCredential: null,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    const organizationId = newOrganizationId();
    const membership: OrganizationMembershipRecord = {
      kind: "organization-membership",
      schemaVersion: 1,
      organizationMembershipId: newOrganizationMembershipId(),
      organizationId,
      productId: "atlas-product-id",
      subjectId: subject.subjectId,
      role: "member",
      status: "active",
      permissionGrants: [],
      createdAt: now,
      updatedAt: now,
    };

    await store.writeRecord(subject);
    await store.writeRecord(membership);

    const puts = send.mock.calls.map(([command]) => command).filter((command) => command instanceof PutObjectCommand);
    const keys = puts.map((command) => command.input.Key).filter((key): key is string => typeof key === "string");
    expect(keys).toContain(`perminister/v2/subjects/${subject.subjectId}.json`);
    expect(keys).toContain(`perminister/v2/orgs/${organizationId}/products/atlas-product-id/members/${subject.subjectId}.json`);
    expect(keys).toContain(`perminister/v2/indexes/by-subject/${subject.subjectId}/products/${organizationId}/atlas-product-id.json`);
    expect(keys.every((key) => !key.includes("/records/") && !key.includes("/events/"))).toBe(true);
    const subjectBody = puts.find((command) => command.input.Key === `perminister/v2/subjects/${subject.subjectId}.json`)?.input.Body;
    expect(JSON.parse(String(subjectBody))).toEqual(subject);
    expect(JSON.parse(String(subjectBody))).not.toHaveProperty("record");

    const emailIndex = puts.find((command) => command.input.Key?.startsWith("perminister/v2/indexes/by-email/"));
    const expectedEmailDigest = createHmac("sha256", "i".repeat(32)).update("person@example.com").digest("hex");
    expect(emailIndex).toBeDefined();
    expect(emailIndex?.input.Key).toBe(`perminister/v2/indexes/by-email/${expectedEmailDigest}.json`);
    expect(JSON.parse(String(emailIndex?.input.Body))).toEqual({ subjectId: subject.subjectId });
  });

  it("writes compact activity at a dated key with organization and product pointers", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new SpacesAuthStore({
      client: { send } as unknown as S3Client,
      bucket: "perminister",
      identityIndexSecret: "i".repeat(32),
    });
    const organizationId = newOrganizationId();
    const event = {
      schemaVersion: 1 as const,
      eventId: newEventId(),
      aggregate: { kind: "organization" as const, id: organizationId },
      aggregateVersion: 1,
      occurredAt: "2026-06-03T15:04:05.000Z",
      actor: { kind: "system" as const },
      type: "product.created",
      payload: { organizationId, productId: "atlas-product-id" },
    };

    await store.appendEvent(event);

    const puts = send.mock.calls.map(([command]) => command).filter((command) => command instanceof PutObjectCommand);
    const keys = puts.map((command) => command.input.Key);
    expect(keys).toContain(`perminister/v2/activity/events/2026-06-03/2026-06-03T15-04-05.000Z-${event.eventId}.json`);
    expect(keys).toContain(`perminister/v2/activity/by-organization/${organizationId}/2026-06-03/${event.eventId}.json`);
    expect(keys).toContain(`perminister/v2/activity/by-product/${organizationId}/atlas-product-id/2026-06-03/${event.eventId}.json`);
    const body = puts.find((command) => command.input.Key?.includes("/activity/events/"))?.input.Body;
    expect(JSON.parse(String(body))).toEqual(event);
    expect(String(body)).not.toContain("password");
  });
});
