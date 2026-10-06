# Authodox v1 contract

Status: initial implementation foundation. This document records an anonymized legacy access inventory, the selected Spaces object layout, and the limits that still block auth flows.

## Goal

Provide a standalone service for human identity, sessions, product/resource-scoped permissions, and API-key lifecycle. Users start from the consumer application they want to access. Authodox performs shared identity checks; each consumer uses the result while keeping its own entry point, app session, domain data, and resource enforcement.

## Confirmed direction

- Project name: Authodox. Local repository folder: `authodox`.
- DigitalOcean Spaces, accessed through its S3-compatible API, is the only persistent store for Authodox. No database.
- Authodox owns user identities, credentials, permission assignments, and API-key creation, rotation, expiration, and revocation.
- Consumer applications remain entry points. Each app handles the sign-in redirect/callback and its own app session, then enforces permissions on its own server-side routes and resources.
- Permission and API-key status may be cached briefly by each app. The maximum cache age and outage behavior remain open.
- A consumer application that already uses a private Spaces control bucket and event-history pattern is a possible first integration.

## Anonymized legacy account and access models

### Email-based project service

- Email/password accounts are scoped to a project. The same email can represent different project accounts.
- Admin-created accounts, Argon2 password hashes, email password-reset links, and database-backed sessions.
- Project roles are viewer, manager, and administrator, with finer-grained action permissions.
- Project API keys, user/tool API keys, and gateway tokens are separate credential types.

### Username-based project service with Spaces sessions

- Username/password accounts; email can be used as a username. Username is the current account key; the user record has no separate immutable ID.
- Scrypt password hashes, admin-managed account creation and reset, and eight-hour session objects in Spaces.
- A platform-wide admin flag plus per-project admin, editor, and viewer memberships.
- A private Spaces control bucket stores append-only user and membership event histories and session objects. Reads list and sort histories. The current pattern does not provide distributed transactions.

### Email-based workspace service

- Email/password accounts are scoped to a workspace, with the workspace slug used at sign-in. The same email can represent accounts in different workspaces.
- Admin-provisioned accounts, Argon2 hashes, admin password resets, and database-backed sessions.
- Workspace roles are admin and viewer.
- PostgreSQL also stores analytics and site data. Moving identity and access to Authodox would not by itself migrate those application data stores.

## Proposed identity and permission model

- Assign every Authodox identity a stable, global subject ID that does not depend on email or username.
- Link each existing project/workspace account to a subject ID through an explicit migration or verified account-linking flow. Do not merge records solely because email values match.
- Represent grants with an explicit consumer application and resource scope, such as product, project, or workspace. Preserve finer-grained actions and platform-wide administrator semantics found in legacy systems during mapping.
- Consumer apps do not maintain their own user-role tables. They receive or retrieve scoped grants and enforce them server-side against their own resources.
- Keep machine credentials separate from human sessions. Each API key should have an owner, application/resource scope, allowed actions, status, creation/expiry/revocation metadata, and audit history. Store only a verifier/hash of the secret; show the raw secret at creation only.
- The boundary between Authodox human sessions and consumer app sessions, including lifetime and logout behavior, still needs a decision.

## Proposed Spaces storage requirements

- Use a private bucket. Only Authodox server components receive Spaces credentials; browser clients and consumer apps do not access the bucket directly.
- Use stable opaque IDs for object keys; avoid putting email addresses or other personal information in keys and metadata.
- Use a versioned record envelope and append-only-by-convention event objects.
- Serialize mutations through one active writer process. Spaces is not treated as a database transaction or uniqueness service.
- Enable Spaces object versioning and maintain a separate backup copy.
- Define cleanup for expired sessions, used/expired reset tokens, revoked/expired API keys, and old event history.

## First code foundation and selected storage contract

The repository contains a minimal Next.js/TypeScript service, an unauthenticated process-liveness endpoint, stable-ID and domain record types, a process-local serial mutation queue, and a server-only S3 SDK adapter. The API-key record has only a SHA-256 verifier digest; no code creates or returns key secrets yet. Password records hold an encoded one-way verifier and support the existing `argon2id` and `scrypt` formats. Auth routes and flows remain unimplemented.

The adapter uses one private, standard Spaces bucket and this fixed prefix:

```text
authodox/v1/records/subjects/{subject-uuid}.json
authodox/v1/records/memberships/{membership-uuid}.json
authodox/v1/records/api-keys/{api-key-uuid}.json
authodox/v1/events/subject/{subject-uuid}/{event-uuid}.json
authodox/v1/events/membership/{membership-uuid}/{event-uuid}.json
authodox/v1/events/api-key/{api-key-uuid}/{event-uuid}.json
```

Record objects contain a `formatVersion`, caller-assigned `revision`, `writtenAt`, and schema-versioned record. The adapter stores the supplied revision but does not check that it increases; the future mutation handler must assign it under the single-writer queue. A later revision overwrites the current object; Spaces object versioning preserves previous object versions once enabled. Events contain their own schema version, event ID, aggregate ID and version, timestamp, actor, type, and payload. Event API methods expose reads and appends, not update or delete. A retry must reuse both the event ID and exact event body. Since the S3-compatible API does not provide a documented conditional-create guarantee in the compatibility reference, a repeated PUT to the same event key is not prevented by this adapter; versioning can retain the prior object version but does not make the event stream immutable against an operator with write access.

Object keys use UUIDs generated by `crypto.randomUUID()`. Product IDs, project/workspace IDs, emails, and other identity data stay in private object bodies, not keys. The adapter rejects non-UUID object IDs and rejects serialized fields named as plaintext secrets, passwords, or tokens. It does not create an email index, lookup index, or uniqueness constraint.

### Mutation boundary and recovery

`SingleWriterMutationQueue` serializes callbacks inside one Node.js process. It is not a distributed lock. Any future mutation routes must use this queue and must run on exactly one active, long-lived writer process; serverless execution, multiple replicas, rolling overlap, or automatic failover would violate this v1 assumption. Read-only routes may be scaled separately only if their access and stale-read behavior are explicitly designed.

The intended per-aggregate write sequence is: under the queue, read the current record revision; construct an event with the next aggregate version and a stable event ID; append the event; then write the new record snapshot at that same revision. The adapter exposes these primitives but does not yet orchestrate or recover the sequence. Spaces does not provide a cross-object transaction, and this contract makes no Amazon S3 strong-consistency claim for Spaces.

If a write times out or the process stops between the event PUT and snapshot PUT, treat the outcome as unknown. Pause mutations for that aggregate, read the exact event key using the original event ID, and replay that event into the snapshot before accepting a later aggregate revision. If the event body conflicts with the intended retry or the state cannot be reconstructed, stop writes and restore from Spaces object versions or the separate backup. Do not retry using a new event ID or guess which write succeeded. There is no automated repair job in this increment, so mutation flows must remain disabled until their replay rules are implemented.

### Operational limits

- Spaces object versioning is disabled by default and must be enabled and verified out of band before Authodox writes. DigitalOcean documents that Spaces supports versioning through its API. Versioning is recovery support, not a separate backup.
- The adapter paginates event-key listings with `ListObjectsV2`, up to 1,000 keys per request, then reads event bodies sequentially. Listing/replay cost grows with the full event history; there are no snapshots, indexes, pruning jobs, or event-retention policy in this increment.
- Spaces applies bucket-level rate limits and can return `503 Slow Down`; the S3 SDK client is configured for three total attempts. A mutation retry must still use its original event ID and body.
- Auth objects are private JSON with `Cache-Control: no-store`. S3 credentials are loaded from server environment variables in `src/lib/auth/storage/spaces.ts` and must never be exposed to browsers or consumer apps.

References: [Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/), [Spaces versioning](https://docs.digitalocean.com/products/spaces/how-to/enable-versioning/), [Spaces limits](https://docs.digitalocean.com/products/spaces/details/limits/).

## Open decisions before implementation

1. Maximum cache age for permission and API-key status, and the required behavior when Authodox cannot be reached.
2. User account-linking flow for existing identities that share an email or username.
3. User sign-in protocol and callback contract for consumer applications.
4. Central versus per-app session lifetime, logout behavior, and account deactivation/revocation semantics.
5. The deployment target must guarantee exactly one active Node.js mutation process, or the single-writer assumption must be replaced with a coordination design that works using Spaces alone.
6. Which legacy machine credential classes (project keys, user/tool keys, gateway tokens, and bootstrap tokens) move under Authodox in v1, or which subset is first.
7. How identity lookup and uniqueness will work without a database, including how duplicate email values remain separate and how explicit legacy-account links are authorized.
8. Which password-hash algorithm new Authodox credentials will use, and the migration/rehash policy for imported Argon2id and scrypt verifiers.

## First vertical slice

1. Create an Authodox identity and explicitly link one legacy consumer account.
2. Sign in from the consumer app through Authodox and establish that app's session.
3. Return a product-scoped permission result and enforce it in the consumer app.
4. Create, use, cache, and revoke one scoped API key with a documented maximum cache delay.
5. Implement and demonstrate recovery from an interrupted or duplicate write in the Spaces-only mutation flow before enabling any state-changing auth route.

The vertical slice proves the identity, permissions, storage, and key lifecycle before additional legacy account models are migrated.
