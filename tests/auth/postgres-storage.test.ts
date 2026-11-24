import { describe, expect, it, vi } from "vitest";
import { PostgresJsonObjectClient } from "../../src/lib/auth/storage/postgres-client";
import type { Pool } from "pg";

vi.mock("server-only", () => ({}));

function fakePool(query = vi.fn()) {
  const client = {
    query,
    release: vi.fn(),
  };
  return {
    pool: {
      query,
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool,
    client,
  };
}

describe("PostgreSQL auth object storage", () => {
  it("stores a JSON record by object key", async () => {
    const { pool } = fakePool();
    const storage = new PostgresJsonObjectClient(pool);
    const payload = { kind: "subject", subjectId: "subject-1" };

    await storage.writeJson("auth/subjects/subject-1.json", payload);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO perminister_objects"), [
      "auth/subjects/subject-1.json",
      JSON.stringify(payload),
    ]);
  });

  it("uses an escaped indexed prefix query when listing keys", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ object_key: "a_1/x.json" }] });
    const { pool } = fakePool(query);
    const storage = new PostgresJsonObjectClient(pool);

    await expect(storage.listKeys("a_1/")).resolves.toEqual(["a_1/x.json"]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("object_key LIKE $1 ESCAPE '!'"),
      ["a!_1/%"],
    );
  });

  it("rolls back all charges when one atomic rate limit is exhausted", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({}); // ROLLBACK
    const { pool, client } = fakePool(query);
    const storage = new PostgresJsonObjectClient(pool);

    await expect(
      storage.consumeRateLimits([
        { namespace: "recovery-email", digest: "a".repeat(64), limit: 3, windowMs: 60_000 },
        { namespace: "recovery-requester", digest: "b".repeat(64), limit: 1, windowMs: 60_000 },
      ]),
    ).resolves.toBe(false);

    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN",
      expect.stringContaining("INSERT INTO perminister_rate_limits"),
      expect.stringContaining("INSERT INTO perminister_rate_limits"),
      "ROLLBACK",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
