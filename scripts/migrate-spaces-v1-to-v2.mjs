import { createHmac, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const ROOT_V1 = "perminister/v1";
const ROOT_V2 = "perminister/v2";
const apply = process.argv.includes("--apply");
const env = process.env;

function required(name) {
  const value = env[name]?.trim();
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
) {
  throw new Error("PERMINISTER_SPACES_ENDPOINT must be the bucket HTTPS endpoint");
}

const client = new S3Client({
  endpoint: `https://${region.toLowerCase()}.digitaloceanspaces.com`,
  region,
  credentials: { accessKeyId, secretAccessKey },
  maxAttempts: 3,
});

const collections = {
  organizations: "organization",
  "organization-memberships": "organization-membership",
  products: "product",
  "organization-invitations": "organization-invitation",
  "service-principals": "service-principal",
  subjects: "subject",
  memberships: "membership",
  "api-keys": "api-key",
  sessions: "session",
  "email-actions": "email-action",
};

function uuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function safeSegment(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`Invalid product ID in source data: ${String(value)}`);
  }
  return value;
}

async function listKeys(prefix) {
  const keys = [];
  const tokens = new Set();
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    keys.push(...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
    if (!page.IsTruncated) break;
    const next = page.NextContinuationToken;
    if (!next || tokens.has(next)) throw new Error(`S3 listing did not advance for ${prefix}`);
    tokens.add(next);
    continuationToken = next;
  } while (true);
  return keys;
}

async function readJson(key) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Missing object body at ${key}`);
  return JSON.parse(await result.Body.transformToString());
}

function recordId(record) {
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
    case "session":
      return record.sessionId;
    case "email-action":
      return record.actionId;
    default:
      throw new Error(`Unknown record kind: ${String(record.kind)}`);
  }
}

function canonicalKey(record) {
  switch (record.kind) {
    case "subject":
      return `${ROOT_V2}/subjects/${record.subjectId}.json`;
    case "organization":
      return `${ROOT_V2}/orgs/${record.organizationId}/organization.json`;
    case "organization-membership":
      return record.productId
        ? `${ROOT_V2}/orgs/${record.organizationId}/products/${safeSegment(record.productId)}/members/${record.subjectId}.json`
        : `${ROOT_V2}/orgs/${record.organizationId}/catalog-managers/${record.subjectId}.json`;
    case "product":
      return `${ROOT_V2}/orgs/${record.organizationId}/products/${safeSegment(record.productId)}/product.json`;
    case "service-principal":
      return `${ROOT_V2}/service-principals/${record.servicePrincipalId}.json`;
    case "organization-invitation":
      return record.productId
        ? `${ROOT_V2}/orgs/${record.organizationId}/products/${safeSegment(record.productId)}/invitations/${record.invitationId}.json`
        : `${ROOT_V2}/invitations/${record.invitationId}.json`;
    case "membership":
      return `${ROOT_V2}/orgs/${record.scope.organizationId}/products/${safeSegment(record.scope.productId)}/members/${record.subjectId}/grants/${record.membershipId}.json`;
    case "api-key":
      return `${ROOT_V2}/api-keys/${record.apiKeyId}.json`;
    case "session":
      return `${ROOT_V2}/sessions/${record.sessionId}.json`;
    case "email-action":
      return `${ROOT_V2}/email-actions/${record.actionId}.json`;
    default:
      throw new Error(`Unknown record kind: ${String(record.kind)}`);
  }
}

function deterministicMembershipId(oldId, organizationId, productId, subjectId) {
  const hex = createHash("sha256")
    .update(`${oldId}\0${organizationId}\0${productId}\0${subjectId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function addOutput(output, key, value) {
  const serialized = JSON.stringify(value);
  const current = output.get(key);
  if (current && JSON.stringify(current) !== serialized)
    throw new Error(`Conflicting migration objects target ${key}`);
  output.set(key, value);
}

function addRecord(output, record) {
  if (!uuid(recordId(record))) throw new Error(`Invalid record ID in ${record.kind}`);
  const key = canonicalKey(record);
  addOutput(output, key, record);
  addOutput(output, `${ROOT_V2}/indexes/by-id/${record.kind}/${recordId(record)}.json`, { key });
  if (record.kind === "subject" && record.primaryEmail) {
    const email = record.primaryEmail.trim().toLowerCase();
    const digest = createHmac("sha256", identityIndexSecret).update(email).digest("hex");
    addOutput(output, `${ROOT_V2}/indexes/by-email/${digest}.json`, {
      subjectId: record.subjectId,
    });
  }
  if (record.kind === "organization-membership") {
    const productPart = record.productId ? safeSegment(record.productId) : "_catalog";
    addOutput(
      output,
      `${ROOT_V2}/indexes/by-subject/${record.subjectId}/products/${record.organizationId}/${productPart}.json`,
      { key },
    );
    for (const grant of record.permissionGrants ?? []) {
      addOutput(output, `${ROOT_V2}/indexes/by-id/membership/${grant.membershipId}.json`, { key });
    }
  }
  if (record.kind === "api-key" && record.owner.kind === "subject") {
    addOutput(
      output,
      `${ROOT_V2}/indexes/by-subject/${record.owner.subjectId}/api-keys/${record.apiKeyId}.json`,
      { key },
    );
  }
  if (record.kind === "session") {
    addOutput(
      output,
      `${ROOT_V2}/indexes/by-subject/${record.subjectId}/sessions/${record.sessionId}.json`,
      { key },
    );
  }
}

function compactEvent(event) {
  const sourceRecord =
    event.payload?.record && typeof event.payload.record === "object" ? event.payload.record : null;
  const payload = {};
  const organizationId =
    sourceRecord?.organizationId ??
    sourceRecord?.scope?.organizationId ??
    event.payload?.organizationId;
  const productId =
    sourceRecord?.productId ?? sourceRecord?.scope?.productId ?? event.payload?.productId;
  const subjectId =
    sourceRecord?.subjectId ??
    sourceRecord?.owner?.subjectId ??
    event.payload?.subjectId ??
    (event.aggregate.kind === "subject" ? event.aggregate.id : undefined);
  if (organizationId && uuid(organizationId)) payload.organizationId = organizationId;
  if (productId) payload.productId = safeSegment(productId);
  if (subjectId && uuid(subjectId)) payload.subjectId = subjectId;
  const occurredAt = new Date(event.occurredAt).toISOString();
  const compact = {
    schemaVersion: 1,
    eventId: event.eventId,
    aggregate: event.aggregate,
    aggregateVersion:
      Number.isSafeInteger(event.aggregateVersion) && event.aggregateVersion > 0
        ? event.aggregateVersion
        : 1,
    occurredAt,
    actor: event.actor,
    type: event.type,
    payload,
  };
  if (!uuid(compact.eventId) || !uuid(compact.aggregate.id))
    throw new Error(`Invalid activity identifier at ${event.eventId}`);
  return compact;
}

function addEvent(output, original) {
  const event = compactEvent(original);
  const date = event.occurredAt.slice(0, 10);
  const key = `${ROOT_V2}/activity/events/${date}/${event.occurredAt.replaceAll(":", "-")}-${event.eventId}.json`;
  addOutput(output, key, event);
  addOutput(
    output,
    `${ROOT_V2}/activity/by-aggregate/${event.aggregate.kind}/${event.aggregate.id}/${event.eventId}.json`,
    { key },
  );
  if (event.payload.organizationId) {
    addOutput(
      output,
      `${ROOT_V2}/activity/by-organization/${event.payload.organizationId}/${date}/${event.eventId}.json`,
      { key },
    );
  }
  if (event.payload.organizationId && event.payload.productId) {
    addOutput(
      output,
      `${ROOT_V2}/activity/by-product/${event.payload.organizationId}/${event.payload.productId}/${date}/${event.eventId}.json`,
      { key },
    );
  }
  if (event.payload.subjectId) {
    addOutput(
      output,
      `${ROOT_V2}/activity/by-subject/${event.payload.subjectId}/${date}/${event.eventId}.json`,
      { key },
    );
  }
}

function membershipKey(organizationId, productId, subjectId) {
  return `${organizationId}\0${productId}\0${subjectId}`;
}

async function main() {
  const output = new Map();
  const sourceRecords = new Map(Object.values(collections).map((kind) => [kind, new Map()]));
  for (const [collection, kind] of Object.entries(collections)) {
    const prefix = `${ROOT_V1}/records/${collection}/`;
    for (const key of await listKeys(prefix)) {
      if (!key.endsWith(".json")) continue;
      const stored = await readJson(key);
      const record = stored?.record ?? stored;
      if (!record || record.kind !== kind || record.schemaVersion !== 1)
        throw new Error(`Malformed v1 record at ${key}`);
      const id = recordId(record);
      const revision = stored?.revision ?? 1;
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error(`Malformed v1 record revision at ${key}`);
      }
      sourceRecords.get(kind).set(id, { record, revision });
    }
  }

  const events = [];
  for (const key of await listKeys(`${ROOT_V1}/events/`)) {
    if (key.endsWith(".json")) events.push(await readJson(key));
  }
  const seenEventRevisions = new Set();
  for (const event of events) {
    const kind = event?.aggregate?.kind;
    const recordsForKind = sourceRecords.get(kind);
    if (!recordsForKind) continue;

    const id = event?.aggregate?.id;
    if (typeof id !== "string" || !id) {
      throw new Error(`Malformed v1 ${kind} activity aggregate identifier`);
    }
    const revision = event.aggregateVersion;
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error(`Malformed v1 ${kind} activity revision for ${id}`);
    }
    const revisionKey = `${kind}\0${id}\0${revision}`;
    if (seenEventRevisions.has(revisionKey)) {
      throw new Error(`Ambiguous v1 history: duplicate ${kind} revision ${revision} for ${id}`);
    }
    seenEventRevisions.add(revisionKey);

    const recovered = event?.payload?.record;
    if (
      !recovered ||
      recovered.kind !== kind ||
      recovered.schemaVersion !== 1 ||
      recordId(recovered) !== id
    ) {
      throw new Error(`Malformed v1 ${kind} activity record for ${id} at revision ${revision}`);
    }

    const current = recordsForKind.get(id);
    if (current?.revision === revision && !isDeepStrictEqual(current.record, recovered)) {
      throw new Error(
        `Ambiguous v1 history: ${kind} snapshot conflicts with revision ${revision} for ${id}`,
      );
    }
    if (!current || revision > current.revision) {
      recordsForKind.set(id, { record: recovered, revision });
    }
  }

  const subjects = [...sourceRecords.get("subject").values()].map(({ record }) => record);
  const organizations = [...sourceRecords.get("organization").values()].map(({ record }) => record);
  const products = [...sourceRecords.get("product").values()].map(({ record }) => record);
  const oldOrgMembers = [...sourceRecords.get("organization-membership").values()].map(
    ({ record }) => record,
  );
  const grants = [...sourceRecords.get("membership").values()].map(({ record }) => record);
  const memberships = new Map();
  let migratedGrantCount = 0;
  let skippedUnscopedGrantCount = 0;
  let revokedUnscopedKeyCount = 0;

  function ensureProductMember(
    organizationId,
    productId,
    subjectId,
    sourceMembership,
    role = "member",
  ) {
    const key = membershipKey(organizationId, productId, subjectId);
    let row = memberships.get(key);
    if (!row) {
      const now = sourceMembership?.createdAt ?? new Date(0).toISOString();
      row = {
        kind: "organization-membership",
        schemaVersion: 1,
        organizationMembershipId: deterministicMembershipId(
          sourceMembership?.organizationMembershipId ?? subjectId,
          organizationId,
          productId,
          subjectId,
        ),
        organizationId,
        productId,
        subjectId,
        role,
        status: sourceMembership?.status === "disabled" ? "disabled" : "active",
        permissionGrants: [],
        createdAt: now,
        updatedAt: sourceMembership?.updatedAt ?? now,
      };
      memberships.set(key, row);
    } else {
      const rank = { member: 1, admin: 2, owner: 3 };
      if (rank[role] > rank[row.role]) row.role = role;
      if (sourceMembership?.status === "active") row.status = "active";
    }
    return row;
  }

  const productsByOrganization = new Map();
  for (const product of products) {
    const list = productsByOrganization.get(product.organizationId) ?? [];
    list.push(product);
    productsByOrganization.set(product.organizationId, list);
  }

  for (const old of oldOrgMembers) {
    if (!uuid(old.organizationId) || !uuid(old.subjectId))
      throw new Error("Malformed legacy organization membership");
    if (old.productId) {
      const product = products.find(
        (candidate) =>
          candidate.organizationId === old.organizationId && candidate.productId === old.productId,
      );
      if (product)
        ensureProductMember(old.organizationId, old.productId, old.subjectId, old, old.role);
      continue;
    }
    if (old.role === "owner" || old.role === "admin") {
      const catalogManager = { ...old, productId: undefined, permissionGrants: undefined };
      addRecord(output, catalogManager);
      if (old.status === "active") {
        for (const product of productsByOrganization.get(old.organizationId) ?? []) {
          ensureProductMember(old.organizationId, product.productId, old.subjectId, old, old.role);
        }
      }
    } else if (old.role === "member") {
      const productIds = new Set(
        grants
          .filter(
            (grant) =>
              grant.subjectId === old.subjectId &&
              grant.scope?.organizationId === old.organizationId,
          )
          .map((grant) => grant.scope.productId)
          .filter(Boolean),
      );
      for (const productId of productIds) {
        if (
          (productsByOrganization.get(old.organizationId) ?? []).some(
            (product) => product.productId === productId,
          )
        ) {
          ensureProductMember(old.organizationId, productId, old.subjectId, old, "member");
        }
      }
    }
  }

  for (const grant of grants) {
    const organizationId = grant.scope?.organizationId;
    const productId = grant.scope?.productId;
    if (!uuid(organizationId) || !productId) {
      skippedUnscopedGrantCount += 1;
      continue;
    }
    const productExists = (productsByOrganization.get(organizationId) ?? []).some(
      (product) => product.productId === productId,
    );
    if (!productExists) continue;
    let member = memberships.get(membershipKey(organizationId, productId, grant.subjectId));
    if (!member)
      member = ensureProductMember(organizationId, productId, grant.subjectId, null, "member");
    if (!member.permissionGrants.some((item) => item.membershipId === grant.membershipId)) {
      member.permissionGrants.push(grant);
      migratedGrantCount += 1;
    }
  }

  for (const subject of subjects) addRecord(output, subject);
  for (const organization of organizations) addRecord(output, organization);
  for (const product of products) addRecord(output, product);
  for (const membership of memberships.values()) addRecord(output, membership);
  for (const { record } of sourceRecords.get("service-principal").values()) {
    addRecord(output, record);
  }
  for (const kind of ["api-key", "session", "email-action"]) {
    for (const { record } of sourceRecords.get(kind).values()) {
      if (kind === "api-key" && !uuid(record.scope?.organizationId)) {
        revokedUnscopedKeyCount += record.status === "active" ? 1 : 0;
        addRecord(output, {
          ...record,
          status: "revoked",
          revokedAt: record.revokedAt ?? new Date().toISOString(),
        });
      } else {
        addRecord(output, record);
      }
    }
  }
  for (const event of events) addEvent(output, event);

  const skippedInvitations = sourceRecords.get("organization-invitation").size;
  const summary = {
    mode: apply ? "apply" : "dry-run",
    sourceRecords: Object.fromEntries(
      [...sourceRecords].map(([kind, values]) => [kind, values.size]),
    ),
    target: {
      objects: output.size,
      subjects: subjects.length,
      organizations: organizations.length,
      products: products.length,
      catalogManagers: oldOrgMembers.filter(
        (member) => !member.productId && (member.role === "owner" || member.role === "admin"),
      ).length,
      productMembers: memberships.size,
      servicePrincipals: sourceRecords.get("service-principal").size,
      permissionGrants: migratedGrantCount,
      skippedUnscopedGrants: skippedUnscopedGrantCount,
      unscopedApiKeysRevoked: revokedUnscopedKeyCount,
      apiKeys: sourceRecords.get("api-key").size,
      sessions: sourceRecords.get("session").size,
      emailActions: sourceRecords.get("email-action").size,
      compactActivityEvents: events.length,
      invitationsNotMigrated: skippedInvitations,
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  const existingKeys = await listKeys(`${ROOT_V2}/`);
  const plannedKeys = new Set(output.keys());
  const unexpected = existingKeys.filter((key) => !plannedKeys.has(key));
  if (unexpected.length)
    throw new Error(
      `v2 contains ${unexpected.length} unplanned objects; refusing to migrate over a non-empty target`,
    );
  for (const key of existingKeys) {
    const existing = await readJson(key);
    if (JSON.stringify(existing) !== JSON.stringify(output.get(key))) {
      throw new Error(
        `v2 object differs from migration output at ${key}; refusing to overwrite it`,
      );
    }
  }
  if (!apply) {
    console.log(
      "Dry run only. Pause app writes, review counts, then rerun with --apply to write v2.",
    );
    return;
  }

  const pending = [...output.entries()].filter(([key]) => !existingKeys.includes(key));
  for (let start = 0; start < pending.length; start += 20) {
    await Promise.all(
      pending.slice(start, start + 20).map(([Key, value]) =>
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
  const readBack = await listKeys(`${ROOT_V2}/`);
  if (readBack.length !== output.size || readBack.some((key) => !plannedKeys.has(key))) {
    throw new Error("v2 object count does not match the prepared migration output");
  }
  for (let start = 0; start < readBack.length; start += 20) {
    await Promise.all(
      readBack.slice(start, start + 20).map(async (key) => {
        const actual = await readJson(key);
        if (JSON.stringify(actual) !== JSON.stringify(output.get(key)))
          throw new Error(`Read-back verification failed at ${key}`);
      }),
    );
  }
  console.log(
    `Wrote and verified ${output.size} v2 objects. Keep v1 read-only as the rollback copy.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
