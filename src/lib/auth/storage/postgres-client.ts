import "server-only";

import { Pool } from "pg";
import { recordAuthStorageOperation } from "../performance";
import type { AuthObjectClient } from "./object-client";

type Environment = Readonly<Record<string, string | undefined>>;

const AUTH_MUTATION_LOCK_KEY = "813474592310421";

let sharedPool: Pool | undefined;
let sharedConnectionString: string | undefined;
let sharedCoordinationPool: Pool | undefined;

function requiredValue(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function poolSize(env: Environment): number {
  const raw = env.PERMINISTER_DATABASE_POOL_MAX?.trim();
  if (!raw) return 10;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("PERMINISTER_DATABASE_POOL_MAX must be an integer from 1 to 100");
  }
  return parsed;
}

export function postgresPoolFromEnv(env: Environment = process.env): Pool {
  const connectionString = requiredValue(env, "DATABASE_URL");
  if (sharedConnectionString && sharedConnectionString !== connectionString) {
    throw new Error("DATABASE_URL changed after the PostgreSQL pool was initialized");
  }
  if (!sharedPool) {
    sharedConnectionString = connectionString;
    sharedPool = new Pool({
      connectionString,
      max: poolSize(env),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: "perminister",
    });
  }
  return sharedPool;
}

function postgresCoordinationPoolFromEnv(env: Environment = process.env): Pool {
  const connectionString = requiredValue(env, "DATABASE_URL");
  if (sharedConnectionString && sharedConnectionString !== connectionString) {
    throw new Error("DATABASE_URL changed after the PostgreSQL pool was initialized");
  }
  if (!sharedCoordinationPool) {
    sharedConnectionString = connectionString;
    sharedCoordinationPool = new Pool({
      connectionString,
      max: Math.max(10, poolSize(env)),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: "perminister-coordination",
    });
  }
  return sharedCoordinationPool;
}

export async function withPostgresMutationLock<Result>(
  operation: () => Promise<Result>,
  mode: "read" | "write",
): Promise<Result> {
  const client = await postgresCoordinationPoolFromEnv().connect();
  const lock = mode === "read" ? "pg_advisory_lock_shared" : "pg_advisory_lock";
  const unlock = mode === "read" ? "pg_advisory_unlock_shared" : "pg_advisory_unlock";
  let acquired = false;
  try {
    await client.query(`SELECT ${lock}($1::bigint)`, [AUTH_MUTATION_LOCK_KEY]);
    acquired = true;
    return await operation();
  } finally {
    try {
      if (acquired) await client.query(`SELECT ${unlock}($1::bigint)`, [AUTH_MUTATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

export function postgresObjectClientFromEnv(): PostgresJsonObjectClient {
  return new PostgresJsonObjectClient(postgresPoolFromEnv());
}

export class PostgresJsonObjectClient implements AuthObjectClient {
  readonly supportsDistributedCoordination = true;
  private readonly pool: Pool;

  constructor(pool = postgresPoolFromEnv()) {
    this.pool = pool;
  }

  async checkReadiness(): Promise<void> {
    const startedAt = performance.now();
    try {
      const result = await this.pool.query<{ objects: string | null; limits: string | null }>(
        `SELECT to_regclass('public.perminister_objects') AS objects,
                to_regclass('public.perminister_rate_limits') AS limits`,
      );
      if (!result.rows[0]?.objects || !result.rows[0]?.limits) {
        throw new Error("Perminister PostgreSQL migrations have not been applied");
      }
    } finally {
      recordAuthStorageOperation("list", performance.now() - startedAt);
    }
  }

  assertWritable(): void {}

  async readJson<Value>(key: string): Promise<Value | null> {
    const startedAt = performance.now();
    try {
      const result = await this.pool.query<{ payload: Value }>(
        "SELECT payload FROM perminister_objects WHERE object_key = $1",
        [key],
      );
      return result.rows[0]?.payload ?? null;
    } finally {
      recordAuthStorageOperation("get", performance.now() - startedAt);
    }
  }

  async writeJson(key: string, value: unknown): Promise<void> {
    this.assertWritable();
    const startedAt = performance.now();
    try {
      await this.pool.query(
        `INSERT INTO perminister_objects (object_key, payload, updated_at)
         VALUES ($1, $2::jsonb, clock_timestamp())
         ON CONFLICT (object_key) DO UPDATE
         SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
        [key, JSON.stringify(value)],
      );
    } finally {
      recordAuthStorageOperation("put", performance.now() - startedAt);
    }
  }

  async deleteObjectAtKey(key: string): Promise<void> {
    this.assertWritable();
    const startedAt = performance.now();
    try {
      await this.pool.query("DELETE FROM perminister_objects WHERE object_key = $1", [key]);
    } finally {
      recordAuthStorageOperation("delete", performance.now() - startedAt);
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    const startedAt = performance.now();
    try {
      const escapedPrefix = `${prefix.replace(/[!%_]/g, "!$&")}%`;
      const result = await this.pool.query<{ object_key: string }>(
        `SELECT object_key FROM perminister_objects
         WHERE object_key LIKE $1 ESCAPE '!' ORDER BY object_key`,
        [escapedPrefix],
      );
      return result.rows.map(({ object_key }) => object_key);
    } finally {
      recordAuthStorageOperation("list", performance.now() - startedAt);
    }
  }

  async listCommonPrefixes(prefix: string, delimiter = "/"): Promise<string[]> {
    if (!delimiter) throw new Error("A delimiter is required");
    const keys = await this.listKeys(prefix);
    const commonPrefixes = new Set<string>();
    for (const key of keys) {
      const relative = key.slice(prefix.length);
      const delimiterIndex = relative.indexOf(delimiter);
      if (delimiterIndex >= 0) {
        commonPrefixes.add(`${prefix}${relative.slice(0, delimiterIndex + delimiter.length)}`);
      }
    }
    return [...commonPrefixes].sort();
  }

  async consumeRateLimit(
    namespace: string,
    digest: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    return this.consumeRateLimits([{ namespace, digest, limit, windowMs }]);
  }

  async consumeRateLimits(
    charges: readonly {
      namespace: string;
      digest: string;
      limit: number;
      windowMs: number;
    }[],
  ): Promise<boolean> {
    if (charges.length === 0) return true;
    const orderedCharges = [...charges].sort(
      (left, right) =>
        left.namespace.localeCompare(right.namespace) || left.digest.localeCompare(right.digest),
    );
    const startedAt = performance.now();
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      for (const charge of orderedCharges) {
        const result = await client.query(
          `INSERT INTO perminister_rate_limits
             (namespace, digest, count, reset_at)
           VALUES ($1, $2, 1, clock_timestamp() + ($4 * interval '1 millisecond'))
           ON CONFLICT (namespace, digest) DO UPDATE
           SET count = CASE
                 WHEN perminister_rate_limits.reset_at <= clock_timestamp() THEN 1
                 ELSE perminister_rate_limits.count + 1
               END,
               reset_at = CASE
                 WHEN perminister_rate_limits.reset_at <= clock_timestamp()
                   THEN clock_timestamp() + ($4 * interval '1 millisecond')
                 ELSE perminister_rate_limits.reset_at
               END
           WHERE perminister_rate_limits.reset_at <= clock_timestamp()
              OR perminister_rate_limits.count < $3
           RETURNING count`,
          [charge.namespace, charge.digest, charge.limit, charge.windowMs],
        );
        if (result.rowCount !== 1) {
          await client.query("ROLLBACK");
          inTransaction = false;
          return false;
        }
      }
      await client.query("COMMIT");
      inTransaction = false;
      return true;
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      recordAuthStorageOperation("put", performance.now() - startedAt);
    }
  }
}

export function createPostgresJsonObjectClientFromEnv(
  env: Environment = process.env,
): PostgresJsonObjectClient {
  requiredValue(env, "DATABASE_URL");
  return new PostgresJsonObjectClient(postgresPoolFromEnv(env));
}

