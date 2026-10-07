# DigitalOcean Spaces layout

Perminister stores current state as private JSON objects directly in the bucket root. The application does not add a project name or storage-version prefix. DigitalOcean Spaces is the only persistent store; there is no database or local-storage fallback.

## Root folders

```text
subjects/{subjectId}.json
orgs/{organizationId}/organization.json
orgs/{organizationId}/catalog-managers/{subjectId}.json
orgs/{organizationId}/products/{productId}/product.json
orgs/{organizationId}/products/{productId}/members/{subjectId}.json
orgs/{organizationId}/products/{productId}/members/{subjectId}/grants/{membershipId}.json
orgs/{organizationId}/products/{productId}/invitations/{invitationId}.json
invitations/{invitationId}.json
service-principals/{servicePrincipalId}.json
api-keys/{apiKeyId}.json
sessions/{sessionId}.json
email-actions/{actionId}.json
indexes/by-id/{recordKind}/{recordId}.json
indexes/by-email/{emailHmac}.json
indexes/by-subject/{subjectId}/...
activity/events/{yyyy-mm-dd}/{timestamp}-{eventId}.json
activity/by-organization/{organizationId}/{yyyy-mm-dd}/{eventId}.json
activity/by-product/{organizationId}/{productId}/{yyyy-mm-dd}/{eventId}.json
activity/by-subject/{subjectId}/{yyyy-mm-dd}/{eventId}.json
activity/by-aggregate/{kind}/{aggregateId}/{eventId}.json
```

Keys contain stable IDs rather than names or email addresses. Email lookup keys use HMAC-SHA-256 over the normalized address with `PERMINISTER_IDENTITY_INDEX_SECRET`. Keep this secret stable; changing it requires rebuilding the email index.

## Data and authorization

Each canonical object contains the current JSON record. Updates replace that object; compact activity entries are separate audit metadata and do not contain previous record snapshots. Lookup and activity pointers are derived from canonical objects and can be rebuilt.

Product membership roles and explicit permission grants are stored together. User-key authorization reads the key, subject, organization, and product member directly. Service-key authorization reads the key, service principal, organization, and product. Neither path lists the bucket or replays activity history.

Organization Owners and Admins manage the catalog. Product Owners and Admins manage product members, invitations, and grants. Product roles do not grant API actions by themselves; an active permission grant is still required for user-owned keys and consumer sessions.

## Recovery and operational limits

Enable object versioning and keep a separate backup before production writes. The index rebuild command scans canonical objects and activity entries without changing them by default:

```sh
npm run storage:rebuild-indexes
npm run storage:rebuild-indexes -- --apply
```

Review the dry-run counts before applying. Rebuilding indexes cannot recreate a missing audit event or canonical record.

Mutation queues and organization locks coordinate work inside one Node.js process only. Spaces has no cross-object transaction or distributed lock, so separate app instances can race on registration, product uniqueness, invitations, membership limits, and multi-object writes. Keep versioning and backups enabled and monitor partial writes.

Passwords, API keys, sessions, and email actions are stored as salted password verifiers or one-way digests. Raw secrets are never stored. Canonical objects and indexes use private ACLs and `Cache-Control: no-store`.
