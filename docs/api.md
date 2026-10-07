# Perminister API and operations

## Account interface

The web interface provides organization requests and switching, product and team management, access grants, API keys, profile, sessions, activity, and organization settings. New organizations stay pending until a configured platform administrator approves them; pending and rejected requests are visible to their requester, and rejected requesters may submit another request. Only approved organizations appear in the workspace switcher or allow dashboard and API access. Dashboard sections are separate pages under `/dashboard/{organizationId}`. Organization catalog managers manage organization and product metadata. Product Owners and Admins manage that product's invitations and grants; only Product Owners change product roles or remove members. Members can review their own product access and account pages. Only organization Owners manage catalog-manager roles and organization settings.

Registration creates a stable UUID identity and a salted scrypt password verifier. Passwords must be at least 15 characters. Email addresses are normalized to lowercase and looked up through a keyed HMAC index; the email address itself is not stored in an object key. Registration does not merge any existing application account. Because multiple app instances can write concurrently, Spaces alone cannot guarantee uniqueness during simultaneous registrations; a deployment-wide coordination layer is required if concurrent registration must be strictly unique. Email verification is sent when Resend is configured, but an unverified account can sign in. An emailed password-recovery link proves control of the registered address and verifies it if needed.

Human sessions use a random, opaque browser token in an HttpOnly, SameSite=Lax cookie; production cookies are Secure. Only a SHA-256 verifier is stored in Spaces. Sessions expire after 12 hours. Signing out revokes the current session. Changing a password increments the account auth version, invalidating every prior session. Server Actions perform their own authorization checks and use Next.js POST and Origin/Host protections; the browser session cookie is not accepted by the bearer authorization API.

## Authorization endpoint

`POST /api/authorize` checks a high-entropy API key against both its own scope/actions and the account's active permission grants. It denies requests for pending or rejected organizations even when the key and grants would otherwise match. Requests use a bearer key and JSON:

```http
POST /api/authorize
Authorization: Bearer pmk_<api-key-uuid>_<secret>
Content-Type: application/json
```

```json
{
  "organizationId": "organization-uuid",
  "productId": "product-id",
  "resourceKind": "project",
  "resourceId": "project-id",
  "action": "read:profile"
}
```

`resourceKind` is `product`, `project`, or `workspace`. A resource ID is required for the latter two. A product grant can authorize a project or workspace within that product; project and workspace grants must match their corresponding resource. A key must independently allow the requested action and cover the requested scope.

An accepted request returns `200` with `{"authorized":true,"subjectId":"..."}`. A denied, expired, revoked, unknown, or out-of-scope key returns `403` with `{"authorized":false}`. Invalid JSON or fields return `400`; missing bearer credentials return `401`. Responses are not cached. Consumer applications must still load and authorize their own domain resource on their server; the endpoint does not fetch consumer data.

`GET /api/auth/session` returns the current account and session expiry for the browser session cookie. It returns `401` when the session is absent or invalid. `GET /api/health` checks process liveness only. `GET /api/ready` makes a limited read request to the configured Spaces bucket and returns `503` when the required storage is unavailable.

## Administration

Set `PERMINISTER_ADMIN_EMAILS` to a comma-separated list of account email addresses for restricted platform operations. This setting is checked on each request and is not stored as an organization role. Platform administrators can review organization requests, manage account status, and retire legacy unscoped grants and keys. One pending organization request is allowed per requesting account. That check uses the process-local mutation queue and can race across separate app instances because Spaces provides no distributed lock. Organization Owners and Admins manage the catalog; only Owners manage catalog-manager roles and organization settings. Product Owners and Admins manage product invitations and grants; only Product Owners change product roles or remove product members. A configured administrator cannot disable its own configured address; remove an address from the environment setting first if it must be disabled.

Organizations, product memberships, products, invitations, and identity/access records are stored as schema-versioned JSON objects under `perminister/v2`. Product IDs are unique within an organization, so two organizations may use the same product ID. API-key and grant scopes include the organization ID; `POST /api/authorize` requires it and checks the matching organization, product, resource, action, active membership, and explicit grant. Current records are the source of truth; activity entries are compact audit metadata and are not replayed to construct current state.

Product website lookups require an owner/admin session and are limited to 10 requests per minute per person and organization per app process. Sign-in throttling reserves capacity for pending checks and counts failures within a 15-minute window. An email is locked for 15 minutes after its eighth failed check. These limits apply per app process and are not shared between app instances.

The Platform operations page includes an idempotent legacy-access migration. It disables active grants without an organization scope and revokes active API keys without an organization scope. It preserves identities, sessions, and audit history. Users then create new grants and keys within an organization. Review the preview counts before running it; rerunning the migration changes no further records once unscoped access has been retired.

Each account can manage its own API keys, including expiry, revocation, and rotation. A raw API key is returned only in the create action response and is never stored. Rotation writes the replacement key first, then revokes the old one; if the second write fails, the dashboard returns the new key with a warning to revoke the old one manually.

## Resend email delivery

The server sends directly to Resend's `POST https://api.resend.com/emails` endpoint; no relay adapter or SDK dependency is needed. Configure `RESEND_API_KEY` with a server-side Resend API key, `PERMINISTER_MAIL_FROM` with a sender address accepted by the Resend account, and `PERMINISTER_PUBLIC_ORIGIN` with the browser-visible application origin. Use a sender address under a verified Resend domain for production.

Each request uses bearer authentication and JSON fields `from`, `to`, `subject`, `text`, and `html`. The API accepts the `to` value as a single address; the application considers a 2xx response accepted and does not parse the returned message ID. The request times out after 10 seconds. Missing configuration, network errors, or non-2xx responses produce a message that no email was sent. Password recovery sends a one-time link to an active account's registered address; completing the reset proves control of that address and verifies it if needed. One-time links expire after 30 minutes and are stored as digests.

Organization invitations also use Resend and expire after seven days. The invitation link is bound to the invited email address; accepting it verifies that address if it was not already verified.

In local development only, `PERMINISTER_PUBLIC_ORIGIN` may use `http://localhost` or `http://127.0.0.1`. Production origins must use HTTPS.

## Environment

| Variable                            | Required           | Purpose                                                                                                   |
| ----------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| `PERMINISTER_SPACES_ENDPOINT`       | Yes                | Bucket endpoint, `https://perminister.sfo3.digitaloceanspaces.com`                                        |
| `PERMINISTER_SPACES_REGION`         | Yes                | Spaces region, `sfo3`                                                                                     |
| `PERMINISTER_SPACES_BUCKET`         | Yes                | Private bucket, `perminister`                                                                             |
| `PERMINISTER_SPACES_ACCESS_KEY`     | Yes                | Server-side Spaces access key                                                                             |
| `PERMINISTER_SPACES_SECRET_KEY`     | Yes                | Server-side Spaces secret key                                                                             |
| `PERMINISTER_IDENTITY_INDEX_SECRET` | Yes                | Stable random secret of at least 32 characters for HMAC email lookup; rebuilding is required to rotate it |
| `PERMINISTER_ADMIN_EMAILS`          | For administration | Comma-separated admin account email addresses                                                             |
| `PERMINISTER_PUBLIC_ORIGIN`         | For email links    | Browser-visible application origin                                                                        |
| `RESEND_API_KEY`                    | For email delivery | Server-side Resend API key; never expose to browser code                                                  |
| `PERMINISTER_MAIL_FROM`             | For email delivery | Sender address accepted by Resend; use a verified domain in production                                    |

There is no session signing secret: browser tokens are generated independently with 256 bits of randomness, and only their digests are persisted. Keep `.env.local` out of source control and use Vercel's environment settings for Vercel values.

## Mutation coordination and recovery

Mutations run through a process-local `SingleWriterMutationQueue` and organization-local lock. They serialize work inside one Node.js process only. A canonical record update replaces its JSON object; compact activity metadata is appended separately. Small by-ID, by-subject, email, and activity pointers support lookups and listings. The canonical record write is the commit point: its derived lookup indexes are written first, and an activity append failure after commit is logged without reporting the mutation itself as failed. These indexes are derived data and can be rebuilt from canonical objects and activity records with `npm run storage:rebuild-v2-indexes` (dry run by default).

Spaces does not provide a conditional cross-object transaction or a distributed lock. A multi-object action can stop partway through, and separate app instances can race on product uniqueness, owner-role limits, invitations, grants, API keys, and account registration. An index write failure prevents the canonical commit, though it may leave harmless or stale pointers; an activity append failure after the canonical commit is logged, and the mutation remains successful. Rebuilding indexes cannot recreate a missing audit event. Enable bucket versioning and keep a separate backup before production writes. Keep the index HMAC secret stable; changing it requires rebuilding the email index before deployments use the new value.

Authorization reads four canonical objects on each request: the API key, subject, organization, and product membership. The membership object contains that person's explicit product grants, so authorization does not list objects or read activity history. The modeled benchmark confirms four object reads and zero list requests per authorization as activity history grows; actual Spaces latency depends on network and bucket response time.

### Recovering partial writes

1. Pause writes on every app instance and take a separate bucket backup. Keep Spaces object versioning enabled so earlier versions of overwritten JSON objects remain available.
2. Inspect the relevant canonical objects under `perminister/v2`, their object versions, and recent activity records. Activity is an audit aid; it is not a full copy of the previous record.
3. If canonical data is correct but a lookup or activity view is incomplete, run `npm run storage:rebuild-v2-indexes` and review the dry-run counts. Apply the rebuild only after confirming it will repair the affected indexes.
4. If a canonical record needs restoration, restore the verified prior object version from the bucket backup/version history, then rebuild derived indexes. Do not infer current state from the activity stream.
5. Verify sign-in, account lookup, product membership, authorization, and activity views before resuming writes.

The v1 prefix is retained read-only after migration. Do not modify it as part of v2 recovery.
