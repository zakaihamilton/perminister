import { createHmac } from "node:crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const ROOT = "perminister/v2";
const apply = process.argv.includes("--apply");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const bucket = required("PERMINISTER_SPACES_BUCKET");
const region = required("PERMINISTER_SPACES_REGION");
const endpoint = required("PERMINISTER_SPACES_ENDPOINT");
const accessKeyId = required("PERMINISTER_SPACES_ACCESS_KEY");
const secretAccessKey = required("PERMINISTER_SPACES_SECRET_KEY");
const identityIndexSecret = required("PERMINISTER_IDENTITY_INDEX_SECRET");
if (identityIndexSecret.length < 32)
  throw new Error("PERMINISTER_IDENTITY_INDEX_SECRET must be at least 32 characters");
const parsedEndpoint = new URL(endpoint);
if (
  parsedEndpoint.protocol !== "https:" ||
  parsedEndpoint.hostname.toLowerCase() !==
    `${bucket.toLowerCase()}.${region.toLowerCase()}.digitaloceanspaces.com` ||
  parsedEndpoint.pathname !== "/" ||
  parsedEndpoint.search ||
  parsedEndpoint.hash ||
  parsedEndpoint.username ||
  parsedEndpoint.password
)
  throw new Error("PERMINISTER_SPACES_ENDPOINT must be the bucket HTTPS endpoint");

const client = new S3Client({
  endpoint: `https://${region.toLowerCase()}.digitaloceanspaces.com`,
  region,
  credentials: { accessKeyId, secretAccessKey },
  maxAttempts: 3,
});

async function listKeys(prefix) {
  const keys = [];
  const seen = new Set();
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    keys.push(...(page.Contents ?? []).flatMap(({ Key }) => (Key ? [Key] : [])));
    if (!page.IsTruncated) break;
    if (!page.NextContinuationToken || seen.has(page.NextContinuationToken))
      throw new Error(`S3 listing did not advance for ${prefix}`);
    seen.add(page.NextContinuationToken);
    token = page.NextContinuationToken;
  } while (true);
  return keys;
}

async function readJson(key) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Missing object body at ${key}`);
  return JSON.parse(await result.Body.transformToString());
}

function add(indexes, key, value) {
  const previous = indexes.get(key);
  if (previous && JSON.stringify(previous) !== JSON.stringify(value))
    throw new Error(`Index key collision at ${key}`);
  indexes.set(key, value);
}

function uuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function safeSegment(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new Error(`Invalid product ID ${String(value)}`);
  return value;
}

function datePart(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid activity timestamp ${timestamp}`);
  return date.toISOString().slice(0, 10);
}

async function main() {
  const indexes = new Map();
  let scanned = 0;
  const prefixes = [
    `${ROOT}/subjects/`,
    `${ROOT}/orgs/`,
    `${ROOT}/invitations/`,
    `${ROOT}/api-keys/`,
    `${ROOT}/sessions/`,
    `${ROOT}/email-actions/`,
    `${ROOT}/activity/events/`,
  ];

  for (const prefix of prefixes) {
    for (const key of await listKeys(prefix)) {
      if (!key.endsWith(".json") || key.includes("/indexes/")) continue;
      const record = await readJson(key);
      scanned += 1;
      if (prefix === `${ROOT}/subjects/`) {
        if (record.kind !== "subject" || !uuid(record.subjectId))
          throw new Error(`Malformed subject at ${key}`);
        add(indexes, `${ROOT}/indexes/by-id/subject/${record.subjectId}.json`, { key });
        if (record.primaryEmail) {
          const digest = createHmac("sha256", identityIndexSecret)
            .update(record.primaryEmail.trim().toLowerCase())
            .digest("hex");
          add(indexes, `${ROOT}/indexes/by-email/${digest}.json`, { subjectId: record.subjectId });
        }
      } else if (key.endsWith("/organization.json")) {
        if (record.kind !== "organization") throw new Error(`Malformed organization at ${key}`);
        add(indexes, `${ROOT}/indexes/by-id/organization/${record.organizationId}.json`, { key });
      } else if (key.endsWith("/product.json")) {
        if (record.kind !== "product") throw new Error(`Malformed product at ${key}`);
        add(indexes, `${ROOT}/indexes/by-id/product/${record.productRecordId}.json`, { key });
      } else if (/\/(catalog-managers|members)\/[^/]+\.json$/.test(key)) {
        if (record.kind !== "organization-membership")
          throw new Error(`Malformed membership at ${key}`);
        const id = record.organizationMembershipId;
        const productPart = record.productId ? safeSegment(record.productId) : "_catalog";
        add(indexes, `${ROOT}/indexes/by-id/organization-membership/${id}.json`, { key });
        add(
          indexes,
          `${ROOT}/indexes/by-subject/${record.subjectId}/products/${record.organizationId}/${productPart}.json`,
          { key },
        );
        for (const grant of record.permissionGrants ?? []) {
          if (!uuid(grant.membershipId))
            throw new Error(`Malformed permission grant embedded at ${key}`);
          add(indexes, `${ROOT}/indexes/by-id/membership/${grant.membershipId}.json`, { key });
        }
      } else if (/\/invitations\/[^/]+\.json$/.test(key) || prefix === `${ROOT}/invitations/`) {
        if (record.kind !== "organization-invitation")
          throw new Error(`Malformed invitation at ${key}`);
        add(indexes, `${ROOT}/indexes/by-id/organization-invitation/${record.invitationId}.json`, {
          key,
        });
      } else if (prefix === `${ROOT}/api-keys/`) {
        if (record.kind !== "api-key") throw new Error(`Malformed API key at ${key}`);
        add(indexes, `${ROOT}/indexes/by-id/api-key/${record.apiKeyId}.json`, { key });
        if (record.owner?.kind === "subject") {
          add(
            indexes,
            `${ROOT}/indexes/by-subject/${record.owner.subjectId}/api-keys/${record.apiKeyId}.json`,
            { key },
          );
        }
      } else if (prefix === `${ROOT}/sessions/`) {
        if (record.kind !== "session") throw new Error(`Malformed session at ${key}`);
        add(indexes, `${ROOT}/indexes/by-id/session/${record.sessionId}.json`, { key });
        add(
          indexes,
          `${ROOT}/indexes/by-subject/${record.subjectId}/sessions/${record.sessionId}.json`,
          { key },
        );
      } else if (prefix === `${ROOT}/email-actions/`) {
        if (record.kind !== "email-action") throw new Error(`Malformed email action at ${key}`);
        add(indexes, `${ROOT}/indexes/by-id/email-action/${record.actionId}.json`, { key });
      } else if (prefix === `${ROOT}/activity/events/`) {
        if (
          record.schemaVersion !== 1 ||
          !uuid(record.eventId) ||
          !record.aggregate?.kind ||
          !uuid(record.aggregate.id)
        )
          throw new Error(`Malformed activity at ${key}`);
        const date = datePart(record.occurredAt);
        add(
          indexes,
          `${ROOT}/activity/by-aggregate/${record.aggregate.kind}/${record.aggregate.id}/${record.eventId}.json`,
          { key },
        );
        if (record.payload?.organizationId) {
          if (!uuid(record.payload.organizationId))
            throw new Error(`Invalid organization ID in activity at ${key}`);
          add(
            indexes,
            `${ROOT}/activity/by-organization/${record.payload.organizationId}/${date}/${record.eventId}.json`,
            { key },
          );
        }
        if (record.payload?.organizationId && record.payload?.productId) {
          add(
            indexes,
            `${ROOT}/activity/by-product/${record.payload.organizationId}/${safeSegment(record.payload.productId)}/${date}/${record.eventId}.json`,
            { key },
          );
        }
        if (record.payload?.subjectId) {
          if (!uuid(record.payload.subjectId))
            throw new Error(`Invalid subject ID in activity at ${key}`);
          add(
            indexes,
            `${ROOT}/activity/by-subject/${record.payload.subjectId}/${date}/${record.eventId}.json`,
            { key },
          );
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        canonicalObjectsScanned: scanned,
        indexesToWrite: indexes.size,
      },
      null,
      2,
    ),
  );
  if (!apply) {
    console.log(
      "Dry run only. Add --apply to rebuild lookup and activity pointers from v2 canonical objects.",
    );
    return;
  }

  const entries = [...indexes.entries()];
  for (let start = 0; start < entries.length; start += 25) {
    await Promise.all(
      entries.slice(start, start + 25).map(([Key, value]) =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key,
            Body: JSON.stringify(value),
            ContentType: "application/json",
            ACL: "private",
            CacheControl: "no-store",
          }),
        ),
      ),
    );
  }
  console.log(`Rebuilt ${indexes.size} v2 lookup and activity indexes.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
