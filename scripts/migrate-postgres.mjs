import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required to apply Perminister migrations");

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  application_name: "perminister-migrations",
});
const lockKey = "813474592310421";

try {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [lockKey]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS perminister_schema_migrations (
        migration_id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    const directory = join(process.cwd(), "db", "migrations");
    const migrationFiles = (await readdir(directory))
      .filter((file) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(file))
      .sort();

    for (const file of migrationFiles) {
      const existing = await client.query(
        "SELECT 1 FROM perminister_schema_migrations WHERE migration_id = $1",
        [file],
      );
      if (existing.rowCount) continue;

      const sql = await readFile(join(directory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO perminister_schema_migrations (migration_id) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
        process.stdout.write(`Applied ${file}\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
    client.release();
  }
} finally {
  await pool.end();
}
