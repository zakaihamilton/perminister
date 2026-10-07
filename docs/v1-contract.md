# S3 storage design and v1-to-v2 migration

Status: v2 is the current direct-object storage layout. The migration tool reads the legacy `perminister/v1` record and event prefixes, writes `perminister/v2`, and leaves v1 untouched.

## Design rules

- DigitalOcean Spaces is the only persistent store. No database or local-storage fallback is used.
- Keys use stable identifiers. Organization IDs, product IDs, subject IDs, and credential IDs belong in keys; names and emails do not.
- Each canonical object is the current JSON document. Updates replace that object. There is no second full-state snapshot per record mutation.
- Activity entries contain event IDs, time, actor, event type, and relevant organization/product/subject IDs. They do not contain a copy of the changed record or credential.
- Listing and lookup pointers are separate small JSON objects. Canonical membership and credential documents remain the authorization source of truth.
- S3 object versioning and a separate backup are the recovery mechanism for overwritten canonical documents.

## Product access model

An organization catalog manager can edit organization and product metadata and browse the product catalog. Catalog manager status does not grant product access or API actions.

Each product has its own Owner, Admin, and Member roles. Product Owners and Admins manage invitations and explicit permission grants. Only Product Owners can change member roles or remove product members, and each product must retain at least one Owner. Product roles describe collaboration and management rights; they do not grant actions to `POST /api/authorize`. An active permission grant is still required.

On v1 migration, an active organization Owner or Admin becomes a catalog manager and keeps the same role on every existing product. A v1 Member becomes a product Member only for products where that subject has a grant. Grants and their active/disabled states are preserved in the product member document. Product creators receive the Product Owner role. Existing organization invitations are not copied; issue new product-scoped invitations after cutover.

## V2 key layout

```text
perminister/v2/subjects/{subjectId}.json
perminister/v2/indexes/by-email/{emailHmac}.json
perminister/v2/indexes/by-subject/{subjectId}/products/{organizationId}/{productId}.json
perminister/v2/indexes/by-subject/{subjectId}/api-keys/{apiKeyId}.json
perminister/v2/indexes/by-subject/{subjectId}/sessions/{sessionId}.json
perminister/v2/indexes/by-id/{recordKind}/{recordId}.json

perminister/v2/orgs/{organizationId}/organization.json
perminister/v2/orgs/{organizationId}/catalog-managers/{subjectId}.json
perminister/v2/orgs/{organizationId}/products/{productId}/product.json
perminister/v2/orgs/{organizationId}/products/{productId}/members/{subjectId}.json
perminister/v2/orgs/{organizationId}/products/{productId}/invitations/{invitationId}.json

perminister/v2/api-keys/{apiKeyId}.json
perminister/v2/sessions/{sessionId}.json
perminister/v2/email-actions/{actionId}.json
perminister/v2/invitations/{invitationId}.json

perminister/v2/activity/events/{yyyy-mm-dd}/{timestamp}-{eventId}.json
perminister/v2/activity/by-organization/{organizationId}/{yyyy-mm-dd}/{eventId}.json
perminister/v2/activity/by-product/{organizationId}/{productId}/{yyyy-mm-dd}/{eventId}.json
perminister/v2/activity/by-subject/{subjectId}/{yyyy-mm-dd}/{eventId}.json
perminister/v2/activity/by-aggregate/{kind}/{aggregateId}/{eventId}.json
```

Each canonical object is schema-versioned JSON, for example:

```json
{
  "kind": "organization-membership",
  "schemaVersion": 1,
  "organizationMembershipId": "membership-record-uuid",
  "organizationId": "organization-uuid",
  "productId": "product-id",
  "subjectId": "subject-uuid",
  "role": "member",
  "status": "active",
  "permissionGrants": [],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Permission grants are embedded in this member document so bearer authorization can check the member role and explicit actions from one product-scoped GET. The complete authorization path performs four direct reads: API key, subject, organization, and product member. It performs no `ListObjects` request and does not read activity history.

The email lookup key is HMAC-SHA-256 over the normalized email, using `PERMINISTER_IDENTITY_INDEX_SECRET`. The key is stable across deployments only while that secret remains stable. Keep a protected copy of it and rebuild the email index before changing it.

## Migration procedure

The deployed v2 service reads v2 only. Migrate the bucket before deploying the v2 application build.

1. Enable Spaces versioning and take a separate bucket backup. Record the current app release and pause writes on every running instance.
2. Configure the Spaces variables and a stable `PERMINISTER_IDENTITY_INDEX_SECRET` of at least 32 characters.
3. Run `npm run storage:migrate-v1-v2`. This is a dry run by default. Review source and target counts, product memberships, skipped invitations, skipped unscoped grants, and revoked unscoped keys.
4. Apply with `npm run storage:migrate-v1-v2 -- --apply`. The tool restores a stale or missing v1 snapshot from its newest full-record event when present, writes v2 canonical objects and pointers, compacts event history, and reads the target objects back for verification.
5. Deploy the v2 application, verify sign-in, organization switching, product membership, API authorization, and activity pages, then keep v1 read-only as the rollback copy.
6. Send new product invitations for people whose old organization-wide invitations were left in v1.

The migration refuses to overwrite v2 objects that differ from its prepared output. This permits an interrupted run to resume when the already-written objects match; it stops if v2 contains post-migration data. Pause writes until verification finishes.

For missing email, subject, record, or activity pointers, first run `npm run storage:rebuild-v2-indexes` to inspect the scan. Apply only after review with `npm run storage:rebuild-v2-indexes -- --apply`. That tool writes indexes from v2 canonical JSON and activity objects without changing those canonical objects.

Unscoped grants cannot be placed under a product and are skipped. Active API keys without an organization scope are retained as revoked records. No raw API secret, browser token, password, email address, or display name is written into an object key.

## Operational boundary

`SingleWriterMutationQueue` and organization locks coordinate only one Node.js process. Spaces does not provide a distributed lock or multi-object transaction, so separate instances can race on unique product IDs, email registration, invitations, role limits, and multi-object mutations. Current records and indexes can also diverge if a write stops partway through. Use bucket versioning, backups, monitoring, and the index rebuild tool; activity is a useful audit trail but is not required to decide authorization.

Raw passwords and bearer-key secrets are never stored. Passwords, API keys, sessions, and email actions use salted password verifiers or one-way digests. All canonical objects and indexes use private ACLs and `Cache-Control: no-store`.
