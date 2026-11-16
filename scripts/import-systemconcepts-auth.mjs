import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!inputPath || process.argv.slice(2).filter((arg) => arg === "--apply").length > 1) {
  throw new Error("Usage: node scripts/import-systemconcepts-auth.mjs <export-file.enc> [--apply]");
}

const keyText = process.env.PERMINISTER_MIGRATION_ENCRYPTION_KEY ?? "";
if (!/^[A-Za-z0-9_-]{43}$/.test(keyText)) {
  throw new Error("PERMINISTER_MIGRATION_ENCRYPTION_KEY must be the 32-byte key used for export");
}
const key = Buffer.from(keyText, "base64url");
if (key.length !== 32) throw new Error("Invalid migration encryption key");

const rawBaseUrl = process.env.PERMINISTER_BASE_URL ?? "";
let baseUrl;
try {
  baseUrl = new URL(rawBaseUrl);
} catch {
  throw new Error("PERMINISTER_BASE_URL must be a valid URL");
}
const localHttp = baseUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(baseUrl.hostname);
if ((!localHttp && baseUrl.protocol !== "https:") || baseUrl.username || baseUrl.password || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
  throw new Error("PERMINISTER_BASE_URL must be an HTTPS origin (or local HTTP origin)");
}

const migrationSecret = process.env.PERMINISTER_SYSTEMCONCEPTS_IMPORT_SECRET ?? "";
if (migrationSecret.length < 32) throw new Error("PERMINISTER_SYSTEMCONCEPTS_IMPORT_SECRET must be at least 32 characters");

const file = JSON.parse(await readFile(resolve(inputPath), "utf8"));
if (
  file?.format !== "systemconcepts-auth-migration-encrypted-v1" ||
  typeof file.nonce !== "string" ||
  typeof file.tag !== "string" ||
  typeof file.ciphertext !== "string"
) {
  throw new Error("Unrecognized encrypted System Concepts export");
}

let payload;
try {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(file.tag, "base64url"));
  payload = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(file.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  );
} catch {
  throw new Error("Could not decrypt the export; check the key and file integrity");
}
if (payload?.format !== "systemconcepts-bcrypt-v1" || !Array.isArray(payload.identities)) {
  throw new Error("Unrecognized decrypted export");
}

const endpoint = new URL("/api/auth/systemconcepts-import", baseUrl);
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Perminister-Migration-Secret": migrationSecret,
  },
  body: JSON.stringify({ apply, identities: payload.identities }),
  cache: "no-store",
  redirect: "error",
  signal: AbortSignal.timeout(60_000),
});
const result = await response.json().catch(() => null);
if (!response.ok || !result || typeof result.total !== "number") {
  throw new Error(`Perminister import endpoint failed (HTTP ${response.status})`);
}

console.log(
  result.applied
    ? `Applied: ${result.total} source accounts`
    : apply
      ? `Not applied: ${result.total} source accounts`
      : `Dry run: ${result.total} source accounts`,
);
console.log(`Imported: ${result.imported}; linked to existing accounts: ${result.linked}; already migrated: ${result.skipped}`);
if (Array.isArray(result.conflicts) && result.conflicts.length > 0) {
  console.log("Conflicts requiring review:");
  for (const conflict of result.conflicts) console.log(`- ${conflict.id}: ${conflict.reason}`);
  process.exitCode = 2;
} else if (!apply) {
  console.log("Dry run only. Repeat with --apply to write these identities.");
}
