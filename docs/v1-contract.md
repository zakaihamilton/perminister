# S3 storage design and v1-to-v2 migration

Status: v2 is the current direct-object storage layout. The migration tool reads the legacy `perminister/v1` record and event prefixes, writes `perminister/v2`, and leaves v1 untouched.

## Design rules

- DigitalOcean Spaces is the only persistent store. No database or local-storage fallback is used.
- Keys use stable identifiers. Organization IDs, product IDs, subject IDs, and credential IDs belong in keys; names and email addresses do not.
- Each canonical object is the current JSON document. Updates replace that object; there is no second full-state snapshot per mutation.
- Activity entries contain event IDs, time, actor, event type, and relevant organization/product/subject IDs. They do not contain a copy of the changed record or credential.
- Listing and lookup pointers are separate small JSON objects. Canonical membership and credential documents remain the authorization source of truth.
- S3 object versioning and a separate backup are the recovery mechanism for overwritten canonical documents.

## Product access model

Organizations are the customer boundary. Organization Owners and Admins manage the catalog; only Owners manage organization catalog-manager roles and settings. Catalog managers edit organization and product metadata, but do not receive product access or API actions automatically.

Each product has its own Owner, Admin, and Member roles. Product Owners and Admins manage invitations and explicit permission grants. Only Product Owners can change member roles or remove product members, and each product must retain at least one Owner. Product roles describe collaboration and management rights; they do not grant actions to `POST /api/authorize`. An active permission grant is still required for user-owned keys and consumer sessions.

First-party product servers authenticate users through the consumer API and product-bound sessions. They keep their own login screens, sessions, profiles, domain data, and server-side resource enforcement. Account linking remains unimplemented; any future migration or link must be explicitly verified, and matching email addresses never merge identities automatically.

Server integrations use service principals scoped to an organization and product. Their API keys also carry resource scope, actions, expiry, status, and rotation history. Raw key secrets are returned only once; the store contains a SHA-256 verifier.

## Legacy v1 layout

V1 stored versioned record snapshots and full-record event history. When a record snapshot lagged or was missing, reads could restore the latest version from its event. The migration reads these legacy prefixes:

```text
perminister/v1/records/subjects/{subjectId}.json
perminister/v1/records/organizations/{organizationId}.json
perminister/v1/records/organization-memberships/{membershipId}.json
perminister/v1/records/products/{productRecordId}.json
perminister/v1/records/organization-invitations/{invitationId}.json
perminister/v1/records/memberships/{membershipId}.json
perminister/v1/records/service-principals/{servicePrincipalId}.json
perminister/v1/records/api-keys/{apiKeyId}.json
perminister/v1/records/sessions/{sessionId}.json
perminister/v1/records/email-actions/{actionId}.json
perminister/v1/events/{aggregateKind}/{aggregateId}/{eventId}.json
```

V1 email directory events also contain normalized addresses so the old implementation can enforce ordinary uniqueness by scanning history. Concurrent registrations can still race across application instances because Spaces does not provide a uniqueness primitive.

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

perminister/v2/service-principals/{servicePrincipalId}.json
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

Product permission grants are embedded in the product member object. User-key authorization reads the key, subject, organization, and product member directly. Service-key authorization reads the key, service principal, organization, and product directly. Neither path lists objects or replays activity history.

The email lookup key is HMAC-SHA-256 over the normalized address, using `PERMINISTER_IDENTITY_INDEX_SECRET`. Keep this secret stable across deployments; rebuild the email index before changing it. Other lookup and activity pointers are derived from canonical objects and can be rebuilt.

## Migration procedure

The v2 service reads and writes v2 only. Migrate an existing bucket before deploying a v2 application build.

1. Enable Spaces versioning and take a separate bucket backup. Record the current app release and pause writes on every running instance.
2. Configure the Spaces variables and a stable `PERMINISTER_IDENTITY_INDEX_SECRET` of at least 32 characters.
3. Run `npm run storage:migrate-v1-v2`. This is a dry run by default. Review source and target counts, product memberships, integrations, skipped invitations, skipped unscoped grants, and revoked unscoped keys.
4. Apply with `npm run storage:migrate-v1-v2 -- --apply`. The tool restores a stale or missing v1 snapshot from its newest full-record event when present, writes v2 canonical objects and pointers, compacts activity history, and reads the target objects back for verification.
5. Deploy the v2 application, verify sign-in, organization switching, product membership, user and service-key authorization, and activity pages, then keep v1 read-only as the rollback copy.
6. Send new product invitations for people whose old organization-wide invitations were left in v1.

The migration refuses to overwrite v2 objects that differ from its prepared output. This allows an interrupted migration to resume when existing v2 objects exactly match the prepared output; it stops if v2 already contains other data. Keep writes paused until verification finishes. Unscoped grants cannot be placed under a product and are skipped. Active API keys without an organization scope are retained as revoked records. Service principals and their scoped keys are preserved.

For missing email, subject, record, or activity pointers, first run `npm run storage:rebuild-v2-indexes` to inspect the scan. Apply only after review with `npm run storage:rebuild-v2-indexes -- --apply`. This writes derived indexes from canonical JSON and activity objects without changing those canonical objects.

## Operational boundary

`SingleWriterMutationQueue` and organization locks coordinate only one Node.js process. Spaces does not provide a distributed lock or multi-object transaction, so separate instances can race on unique product IDs, email registration, invitations, role limits, and multi-object mutations. Current records and indexes can diverge if a write stops partway through. Use bucket versioning, backups, monitoring, and the index rebuild tool; activity is a useful audit trail but is not required to decide authorization.

Raw passwords and bearer-key secrets are never stored. Passwords, API keys, sessions, and email actions use salted password verifiers or one-way digests. All canonical objects and indexes use private ACLs and `Cache-Control: no-store`.
