import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const kind = process.argv[2];
if (kind !== "postgres" && kind !== "s3") {
  throw new Error("Usage: node scripts/initialize-self-hosted-env.mjs postgres|s3");
}

const directory = resolve("deploy/self-hosted");
const example = resolve(directory, `.env.${kind}.example`);
const output = resolve(directory, `.env.${kind}`);
let contents = await readFile(example, "utf8");

function setValue(name, value) {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(contents)) throw new Error(`The template is missing ${name}`);
  contents = contents.replace(pattern, `${name}=${value}`);
}

setValue("PERMINISTER_IDENTITY_INDEX_SECRET", randomBytes(32).toString("hex"));
setValue("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));

if (kind === "postgres") {
  const password = randomBytes(32).toString("hex");
  const username = contents.match(/^POSTGRES_USER=(.*)$/m)?.[1];
  const database = contents.match(/^POSTGRES_DB=(.*)$/m)?.[1];
  if (!username || !database) throw new Error("The PostgreSQL template is incomplete");
  const databaseUrl = new URL(`postgresql://${username}@db:5432/${encodeURIComponent(database)}`);
  databaseUrl.password = password;
  setValue("POSTGRES_PASSWORD", password);
  setValue("DATABASE_URL", databaseUrl.toString());
}

await writeFile(output, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
await chmod(output, 0o600);
process.stdout.write(`Created ${output} with generated secrets. Edit its service settings before starting Perminister.\n`);
