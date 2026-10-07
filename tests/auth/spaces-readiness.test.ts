import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { SpacesAuthStore } from "../../src/lib/auth/storage/spaces";

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
});
