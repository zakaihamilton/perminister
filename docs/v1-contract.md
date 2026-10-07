# Perminister v1 contract

Status: the first identity and access experience is implemented against DigitalOcean Spaces. This document records the anonymized legacy access inventory, the current object layout, and the operational limits that remain.

## Goal

Provide a standalone service where organizations manage products, people, and product/resource-scoped access, while members manage their own account and API keys. Consumer applications keep their own entry point, app session, domain data, and resource enforcement.

## Confirmed direction

- Project name: Perminister. Local repository folder: `perminister`.
- DigitalOcean Spaces, accessed through its S3-compatible API, is the only persistent store for Perminister. No database.
- Organizations are the customer boundary. Owner, Admin, and Member roles control dashboard pages and actions; the configured platform administrator is restricted to operations work.
- Each organization owns its product catalog. Product IDs are unique within an organization, and permission/API-key scopes carry the organization ID.
- Perminister owns user identities, credentials, permission assignments, and API-key creation, rotation, expiration, and revocation.
- Consumer applications remain entry points and keep branded login pages, their own app sessions, product profile/preferences, domain data, and server-side resource enforcement. Product backends authenticate users through the first-party consumer API and product-bound sessions; redirect-based OIDC is not part of this integration.
- One product ID can be registered under many organizations. A product-bound application client is restricted to that product, while organization IDs, users, grants, integration identities, and credentials stay tenant-scoped.
- Perminister checks API-key expiry, revocation, scope, actions, and current grants on each authorization request. This implementation does not cache permission or key status.
- Account linking remains unimplemented. Any future link must be an explicit, separately verified flow; email matching alone never merges identities.

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
- PostgreSQL also stores analytics and site data. Moving identity and access to Perminister would not by itself migrate those application data stores.

## Identity and permission model

- Each Perminister identity has a stable UUID subject ID, normalized email, scrypt verifier, active/disabled status, email verification time, and auth version. Directory checks enforce uniqueness in ordinary operation; concurrent registrations across app instances can still race because Spaces alone provides no uniqueness primitive.
- Existing project/workspace accounts are not linked automatically. An explicit verified migration/linking flow is still required for each consumer.
- Grants carry organization, product, optional project/workspace scope, and action names. Organization Owners and Admins assign them through the dashboard; consumer applications enforce each decision against their own resources.
- User API keys are subject-owned credentials. Service principals are organization/product-scoped machine identities with API keys that carry an explicit resource scope, action list, status, expiry, revocation time, and rotation relationship. The application stores only a SHA-256 verifier of each 256-bit random key secret and displays the raw key only in the create response.
- Perminister dashboard sessions and product-bound consumer sessions last 12 hours. Product servers exchange credentials with Perminister and maintain their own HttpOnly, SameSite cookies (Secure in production); they call Perminister to validate sessions, list eligible organizations, revoke sessions, and authorize requests.

## Spaces storage requirements

- Use a private bucket. Only Perminister server components receive Spaces credentials; browser clients and consumer apps do not access the bucket directly.
- Use stable opaque IDs for object keys; avoid putting email addresses or other personal information in keys and metadata.
- Use a versioned record envelope and append-only-by-convention event objects.
- Mutations are serialized within each process only. Multi-instance writes may race; Spaces is not treated as a distributed lock, database transaction, or uniqueness service.
- Enable Spaces object versioning and maintain a separate backup copy.
- Define cleanup for expired sessions, used/expired reset tokens, revoked/expired API keys, and old event history.

## Implemented code and selected storage contract

The repository contains account registration and sign-in, organization creation/switching, membership and invitation management, product setup from URLs or optional Brave Search, scoped grants, profile and session pages, user API-key create/list/rotate/expire/revoke, organization activity, platform operations, consumer registration/login/verification/recovery/session APIs, product-bound authorization, and organization/product-scoped service principals with scoped machine keys. Passwords use Node.js `scrypt` with a random salt and fixed explicit parameters. The app has no external database or local-storage fallback. Email delivery is optional and uses the Resend Email API; verification, recovery, and invitations stay unavailable until the Resend key, sender, and public origin are configured.

The adapter uses one private Spaces bucket and these prefixes:

```text
perminister/v1/records/subjects/{subject-uuid}.json
perminister/v1/records/organizations/{organization-uuid}.json
perminister/v1/records/organization-memberships/{organization-membership-uuid}.json
perminister/v1/records/products/{product-record-uuid}.json
perminister/v1/records/organization-invitations/{invitation-uuid}.json
perminister/v1/records/memberships/{membership-uuid}.json
perminister/v1/records/service-principals/{service-principal-uuid}.json
perminister/v1/records/api-keys/{api-key-uuid}.json
perminister/v1/records/sessions/{session-uuid}.json
perminister/v1/records/email-actions/{action-uuid}.json
perminister/v1/events/subject/{subject-uuid}/{event-uuid}.json
perminister/v1/events/organization/{organization-uuid}/{event-uuid}.json
perminister/v1/events/organization-membership/{organization-membership-uuid}/{event-uuid}.json
perminister/v1/events/product/{product-record-uuid}/{event-uuid}.json
perminister/v1/events/organization-invitation/{invitation-uuid}/{event-uuid}.json
perminister/v1/events/membership/{membership-uuid}/{event-uuid}.json
perminister/v1/events/service-principal/{service-principal-uuid}/{event-uuid}.json
perminister/v1/events/api-key/{api-key-uuid}/{event-uuid}.json
perminister/v1/events/session/{session-uuid}/{event-uuid}.json
perminister/v1/events/email-action/{action-uuid}/{event-uuid}.json
perminister/v1/events/directory/00000000-0000-4000-8000-000000000001/{event-uuid}.json
```

Record objects contain a `formatVersion`, revision, `writtenAt`, and schema-versioned record. For each mutation, the application appends a complete next-record event first, then writes the current snapshot. A read compares the snapshot revision with the latest event and repairs a missing/stale snapshot from the event. Directory registration events contain normalized email and the subject snapshot; email uniqueness checks scan this directory event stream instead of storing emails in object keys. Email action/session/API-key values are one-way verifiers; raw passwords and bearer secrets never enter Spaces.

This event/snapshot sequence is recoverable per record, not transactional across records. A retry uses a new event for a new revision after replaying any completed prior event. DigitalOcean Spaces does not supply a conditional cross-object transaction. Object versioning can retain prior snapshot versions, but does not make event keys immutable against an operator with write access.

Object keys use UUIDs generated by `crypto.randomUUID()`. Product IDs, project/workspace IDs, emails, and other identity data stay in private object bodies, not keys. The adapter rejects non-UUID object IDs and rejects serialized fields named as plaintext secrets, passwords, or tokens. Account lookups and audit history list event objects; read cost grows with full history.

### Mutation boundary and recovery

`SingleWriterMutationQueue` serializes callbacks inside one Node.js process. Organization-local locks also exist only in that process. DigitalOcean Spaces is the only persistent record store. Sign-in throttling and product lookup rate limits are held in process memory and are not shared between app instances. Every mutation outside that process can overlap with another writer and retains cross-instance race risk.

The write sequence is: under the queue, replay the latest event if needed; read the current record and event revision; construct a full next-record event; append it; then write the snapshot at that revision. Directory account creation writes its directory event before the subject event/snapshot, allowing a later email lookup to repair an interrupted registration. Authorization reads current grants and keys from Spaces on every check, so revocation takes effect without a cache delay once the S3 write completes.

If a write times out or the process stops between event PUT and snapshot PUT, reads replay the latest complete event into the snapshot before accepting a later revision. Cross-aggregate operations remain partial: recovery links are marked consumed before credential changes, so a crash between those writes may require a fresh recovery email; rotation creates a replacement before revoking the prior key and reports when prior-key revocation fails. Inspect event history and Spaces versions before manual repair; do not infer whether a multi-record action completed from the browser response alone.

### Operational limits

- Spaces object versioning is disabled by default and must be enabled and verified out of band before Perminister writes. DigitalOcean documents that Spaces supports versioning through its API. Versioning is recovery support, not a separate backup.
- Identity lookup, event recovery, audit history, and authorization list relevant event/snapshot objects from Spaces. Costs grow with object count; there are no compaction, pruning, or event-retention jobs.
- Spaces applies bucket-level rate limits and can return `503 Slow Down`; the S3 SDK client is configured for three total attempts. A mutation retry must still use its original event ID and body.
- Auth objects are private JSON with `Cache-Control: no-store`. S3 credentials are loaded from server environment variables in `src/lib/auth/storage/spaces.ts` and must never be exposed to browsers or consumer apps.
- Password recovery and verification require `RESEND_API_KEY`, `PERMINISTER_MAIL_FROM`, and `PERMINISTER_PUBLIC_ORIGIN`. Use a sender from a verified Resend domain. Completing a recovery link proves address ownership and verifies an unverified account. See the direct Resend API setup in [the API guide](api.md).
- Configure restricted platform operations accounts with `PERMINISTER_ADMIN_EMAILS`. Organization Owners and Admins manage customer products, invitations, and grants. Members see their access and account pages. Unverified identities cannot create API keys or receive new grants.
- The platform operations migration disables active grants without an organization and revokes active API keys without an organization scope. It preserves identities, sessions, and audit events and is safe to run repeatedly.

References: [Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/), [Spaces versioning](https://docs.digitalocean.com/products/spaces/how-to/enable-versioning/), [Spaces limits](https://docs.digitalocean.com/products/spaces/details/limits/).

## Remaining decisions and deployment work

1. Integrate Visitoring and PostParticle backends with the consumer APIs, set their product-owned session cookies, and implement their branded verification/recovery pages. Add a verified legacy account-linking or migration flow before replacing each product's existing login.
2. All mutations use process-local coordination only and can race across serverless instances. Duplicate event revisions and duplicate directory registrations are rejected when detected, but Spaces alone cannot guarantee cross-instance mutual exclusion or uniqueness.
3. If consumer apps cache authorization responses, each integration must choose a maximum cache age and outage behavior. The current authorization route itself does not cache.
4. Define event compaction and retention before directory and audit history becomes large.
5. Configure a Resend API key and a sender from a verified domain before enabling email verification/recovery in production.

## First vertical slice

1. Register and verify a new Perminister identity, create an organization, add a product, and invite a teammate.
2. Configure a first-party app client, sign in through the consumer API, store the product-bound session in the product's cookie, and verify organization discovery and interactive authorization.
3. Create an organization/product service principal, issue a project-scoped machine key, and verify telemetry authorization for that project while another project's request is denied.
4. Rotate, expire, and revoke the user and service keys; confirm the authorization route reflects the changes from Spaces.
5. Exercise replay after an interrupted event/snapshot write and document the multi-record recovery procedure before production writes.
