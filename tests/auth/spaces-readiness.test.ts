import { ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { newOrganizationId, newSubjectId } from "../../src/lib/auth/domain";
import { createSpacesAuthStoreFromEnv, SpacesAuthStore } from "../../src/lib/auth/storage/spaces";

vi.mock("server-only", () => ({}));

describe("Spaces readiness", () => {
  it("checks access to the auth object prefix with one limited list request", async () => {
    const send = vi.fn().mockResolvedValue({ Contents: [] });
    const store = new SpacesAuthStore({
      client: { send } as unknown as S3Client,
      bucket: "perminister",
      identityIndexSecret: "x".repeat(32),
    });

    await store.checkReadiness();

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input).toMatchObject({
      Bucket: "perminister",
      Prefix: "",
      MaxKeys: 1,
    });
  });

  it("propagates a Spaces access failure", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Forbidden"));
    const store = new SpacesAuthStore({
      client: { send } as unknown as S3Client,
      bucket: "perminister",
      identityIndexSecret: "x".repeat(32),
    });

    await expect(store.checkReadiness()).rejects.toThrow("Forbidden");
  });

  it("refuses writes in read-only mode or against the production bucket without writer mode", async () => {
    const send = vi.fn().mockResolvedValue({ Contents: [] });
    const store = createSpacesAuthStoreFromEnv({
      PERMINISTER_SPACES_ENDPOINT: "https://perminister.nyc3.digitaloceanspaces.com",
      PERMINISTER_SPACES_REGION: "nyc3",
      PERMINISTER_SPACES_BUCKET: "perminister",
      PERMINISTER_SPACES_ACCESS_KEY: "access",
      PERMINISTER_SPACES_SECRET_KEY: "secret",
      PERMINISTER_IDENTITY_INDEX_SECRET: "x".repeat(32),
    });
    const now = new Date().toISOString();
    await expect(
      store.writeRecord({
        kind: "organization",
        schemaVersion: 1,
        organizationId: newOrganizationId(),
        name: "Org",
        createdBySubjectId: newSubjectId(),
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow("Spaces store is configured as read-only in this runtime");
    expect(send).not.toHaveBeenCalledWith(expect.any(PutObjectCommand));
  });
});
