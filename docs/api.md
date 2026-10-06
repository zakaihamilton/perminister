# Perminister API and operations

## Account interface

The web interface provides organization onboarding and switching, product and team management, access grants, API keys, profile, sessions, activity, and organization settings. Dashboard sections are separate pages under `/dashboard/{organizationId}`. Members see their own access and account pages; owners and admins manage products, invitations, and grants; only owners manage organization roles and settings.

Registration creates a stable UUID identity and a salted scrypt password verifier. Passwords must be at least 15 characters. Email addresses are normalized to lowercase and checked against Perminister's private directory event log. Registration does not merge any existing application account. Because multiple app instances can write concurrently, Spaces alone cannot guarantee uniqueness during simultaneous registrations; detected duplicate registrations stop directory reads for manual reconciliation. Email verification is sent when Resend is configured, but an unverified account can sign in. An emailed password-recovery link proves control of the registered address and verifies it if needed.

Human sessions use a random, opaque browser token in an HttpOnly, SameSite=Lax cookie; production cookies are Secure. Only a SHA-256 verifier is stored in Spaces. Sessions expire after 12 hours. Signing out revokes the current session. Changing a password increments the account auth version, invalidating every prior session. Server Actions perform their own authorization checks and use Next.js POST and Origin/Host protections; the browser session cookie is not accepted by the bearer authorization API.

## Authorization endpoint

`POST /api/authorize` checks a high-entropy API key against both its own scope/actions and the account's active permission grants. Requests use a bearer key and JSON:

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

Set `PERMINISTER_ADMIN_EMAILS` to a comma-separated list of account email addresses for restricted platform operations. This setting is checked on each request and is not stored as an organization role. Platform administrators can manage account status and retire legacy unscoped grants and keys. Customer product and access management uses organization membership roles: Owners and Admins manage products, invitations, and grants; only Owners manage organization roles and organization settings. A configured administrator cannot disable its own configured address; remove an address from the environment setting first if it must be disabled.

Organizations, memberships, products, and invitations are persisted as versioned records and events alongside identity and access records. Product IDs are unique within an organization, so two organizations may use the same product ID. API-key and grant scopes include the organization ID; `POST /api/authorize` requires it and checks the matching organization, product, resource, action, active membership, and grant.

Product website lookups require an owner/admin session and are limited to 10 requests per minute per person and organization per app process. Sign-in throttling reserves capacity for pending checks and counts failures within a 15-minute window. An email is locked for 15 minutes after its eighth failed check. These limits apply per app process and are not shared between app instances.

The Platform operations page includes an idempotent legacy-access migration. It disables active grants without an organization scope and revokes active API keys without an organization scope. It preserves identities, sessions, and audit history. Users then create new grants and keys within an organization. Review the preview counts before running it; rerunning the migration changes no further records once unscoped access has been retired.

Each account can manage its own API keys, including expiry, revocation, and rotation. A raw API key is returned only in the create action response and is never stored. Rotation writes the replacement key first, then revokes the old one; if the second write fails, the dashboard returns the new key with a warning to revoke the old one manually.

## Resend email delivery

The server sends directly to Resend's `POST https://api.resend.com/emails` endpoint; no relay adapter or SDK dependency is needed. Configure `RESEND_API_KEY` with a server-side Resend API key, `PERMINISTER_MAIL_FROM` with a sender address accepted by the Resend account, and `PERMINISTER_PUBLIC_ORIGIN` with the browser-visible application origin. Use a sender address under a verified Resend domain for production.

Each request uses bearer authentication and JSON fields `from`, `to`, `subject`, `text`, and `html`. The API accepts the `to` value as a single address; the application considers a 2xx response accepted and does not parse the returned message ID. The request times out after 10 seconds. Missing configuration, network errors, or non-2xx responses produce a message that no email was sent. Password recovery sends a one-time link to an active account's registered address; completing the reset proves control of that address and verifies it if needed. One-time links expire after 30 minutes and are stored as digests.

Organization invitations also use Resend and expire after seven days. The invitation link is bound to the invited email address; accepting it verifies that address if it was not already verified.

In local development only, `PERMINISTER_PUBLIC_ORIGIN` may use `http://localhost` or `http://127.0.0.1`. Production origins must use HTTPS.

## Environment

| Variable                        | Required           | Purpose                                                                                     |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `PERMINISTER_SPACES_ENDPOINT`   | Yes                | Bucket endpoint, `https://perminister.sfo3.digitaloceanspaces.com`                          |
| `PERMINISTER_SPACES_REGION`     | Yes                | Spaces region, `sfo3`                                                                       |
| `PERMINISTER_SPACES_BUCKET`     | Yes                | Private bucket, `perminister`                                                               |
| `PERMINISTER_SPACES_ACCESS_KEY` | Yes                | Server-side Spaces access key                                                               |
| `PERMINISTER_SPACES_SECRET_KEY` | Yes                | Server-side Spaces secret key                                                               |
| `PERMINISTER_ADMIN_EMAILS`      | For administration | Comma-separated admin account email addresses                                               |
| `PERMINISTER_PUBLIC_ORIGIN`     | For email links    | Browser-visible application origin                                                          |
| `RESEND_API_KEY`                | For email delivery | Server-side Resend API key; never expose to browser code                                    |
| `PERMINISTER_MAIL_FROM`         | For email delivery | Sender address accepted by Resend; use a verified domain in production                      |
| `BRAVE_SEARCH_API_KEY`          | For name search    | Optional server-side Brave Search subscription token; direct URL import does not require it |

There is no session signing secret: browser tokens are generated independently with 256 bits of randomness, and only their digests are persisted. Keep `.env.local` out of source control and use Vercel's environment settings for Vercel values.

## Mutation coordination and recovery

Every mutation runs through a process-local `SingleWriterMutationQueue` and organization-local lock. These serialize work inside one Node.js process only. Each record update appends a versioned full-record event before writing the record snapshot. Reads replay the latest complete event to repair a missing or stale snapshot. Account registration also records the normalized email and subject snapshot in a directory event before the subject record, so a later lookup can recover a registration interrupted between those writes.

This is recoverable per record, not a cross-object transaction. Spaces does not provide a conditional cross-object transaction or a distributed lock. Concurrent app instances can race, including on product uniqueness, owner-role limits, invitations, grants, API keys, and account registration. Duplicate aggregate revisions cause an integrity error before event replay or snapshot repair rather than an arbitrary event being selected. Duplicate directory registrations are also rejected when detected. These checks expose some races but do not prevent them; manual reconciliation may be required. Event listing and identity lookup scan S3 objects, so cost grows with history. Enable bucket versioning and keep a separate backup before production writes.

Authorization reads current keys and grants from Spaces on every request and run outside the mutation queue. They are not cached; an update is reflected once its event has been written and no conflicting event history is present.

### Recovering an integrity conflict

If an authorization or account lookup reports an event-revision or duplicate-email integrity error:

1. Pause writes on every app instance and take a separate backup of the bucket. Keep Spaces object versioning enabled so prior object versions remain available.
2. Inspect the private event objects under `perminister/v1/events/{aggregate-kind}/{aggregate-id}/`. Compare aggregate versions, event IDs, event bodies, matching record snapshots, and the related audit history.
3. For a duplicated aggregate revision, preserve a copy of every conflicting event, then move the event that does not match the confirmed operation out of the active event prefix. Keep exactly one event for each aggregate revision.
4. For a duplicate email registration, identify the account that owns the intended identity. Review grants, API keys, sessions, and organization memberships that refer to each subject before removing a duplicate directory entry; the application does not merge accounts automatically.
5. Restart writes only after the active history contains one event per revision and one directory identity for the normalized email. A normal read can then rebuild a missing or stale snapshot from the remaining event history. Recheck account lookup and authorization before resuming traffic.

Do not edit or remove the only copy of an event during recovery. If the intended state cannot be established from Spaces versions and audit evidence, keep writes paused and preserve both histories for investigation.
