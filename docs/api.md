# Perminister API and operations

## Account interface

The web interface provides email/password account creation, sign-in, sign-out, current profile, session listing and revocation, API-key management, and permission-grant management. The dashboard is at `/dashboard`; account forms are at `/register`, `/login`, and `/forgot-password`.

Registration creates a stable UUID identity and a salted scrypt password verifier. Passwords must be at least 15 characters. Email addresses are normalized to lowercase and are unique in Perminister's private directory event log. Registration does not merge any existing application account. Email verification is sent when Resend is configured, but an unverified account can sign in. An emailed password-recovery link proves control of the registered address and verifies it if needed.

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
  "productId": "product-id",
  "resourceKind": "project",
  "resourceId": "project-id",
  "action": "read:profile"
}
```

`resourceKind` is `product`, `project`, or `workspace`. A resource ID is required for the latter two. A product grant can authorize a project or workspace within that product; project and workspace grants must match their corresponding resource. A key must independently allow the requested action and cover the requested scope.

An accepted request returns `200` with `{"authorized":true,"subjectId":"..."}`. A denied, expired, revoked, unknown, or out-of-scope key returns `403` with `{"authorized":false}`. Invalid JSON or fields return `400`; missing bearer credentials return `401`. Responses are not cached. Consumer applications must still load and authorize their own domain resource on their server; the endpoint does not fetch consumer data.

`GET /api/auth/session` returns the current account and session expiry for the browser session cookie. It returns `401` when the session is absent or invalid. `GET /api/health` checks process liveness only.

## Administration

Set `PERMINISTER_ADMIN_EMAILS` to a comma-separated list of account email addresses. Those accounts receive access to the dashboard identity directory and grant controls after they register and verify ownership of the configured address. Unverified identities cannot administer Perminister, create API keys, or receive new permission grants. This setting is checked on each request and is not stored as a role in Spaces. A configured administrator cannot disable its own configured address; remove an address from the environment setting first if it must be disabled.

Administrators can list identities, enable or disable accounts, create product/project/workspace grants, and revoke or restore grants. Each account can manage its own API keys, including expiry, revocation, and rotation. A raw API key is returned only in the create action response and is never stored. Rotation writes the replacement key first, then revokes the old one; if the second write fails, the dashboard returns the new key with a warning to revoke the old one manually.

## Resend email delivery

The server sends directly to Resend's `POST https://api.resend.com/emails` endpoint; no relay adapter or SDK dependency is needed. Configure `RESEND_API_KEY` with a server-side Resend API key, `PERMINISTER_MAIL_FROM` with a sender address accepted by the Resend account, and `PERMINISTER_PUBLIC_ORIGIN` with the browser-visible application origin. Use a sender address under a verified Resend domain for production.

Each request uses bearer authentication and JSON fields `from`, `to`, `subject`, `text`, and `html`. The API accepts the `to` value as a single address; the application considers a 2xx response accepted and does not parse the returned message ID. The request times out after 10 seconds. Missing configuration, network errors, or non-2xx responses produce a message that no email was sent. Password recovery sends a one-time link to an active account's registered address; completing the reset proves control of that address and verifies it if needed. One-time links expire after 30 minutes and are stored as digests.

In local development only, `PERMINISTER_PUBLIC_ORIGIN` may use `http://localhost` or `http://127.0.0.1`. Production origins must use HTTPS.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `PERMINISTER_SPACES_ENDPOINT` | Yes | Bucket endpoint, `https://perminister.sfo3.digitaloceanspaces.com` |
| `PERMINISTER_SPACES_REGION` | Yes | Spaces region, `sfo3` |
| `PERMINISTER_SPACES_BUCKET` | Yes | Private bucket, `perminister` |
| `PERMINISTER_SPACES_ACCESS_KEY` | Yes | Server-side Spaces access key |
| `PERMINISTER_SPACES_SECRET_KEY` | Yes | Server-side Spaces secret key |
| `PERMINISTER_ADMIN_EMAILS` | For administration | Comma-separated admin account email addresses |
| `PERMINISTER_PUBLIC_ORIGIN` | For email links | Browser-visible application origin |
| `RESEND_API_KEY` | For email delivery | Server-side Resend API key; never expose to browser code |
| `PERMINISTER_MAIL_FROM` | For email delivery | Sender address accepted by Resend; use a verified domain in production |

There is no session signing secret: browser tokens are generated independently with 256 bits of randomness, and only their digests are persisted. Keep `.env.local` out of source control and use Vercel's environment settings for Vercel values.

## Single-writer boundary

Every mutation runs through a process-local `SingleWriterMutationQueue`. Each record update appends a versioned full-record event before writing the record snapshot. Reads replay the latest complete event to repair a missing or stale snapshot. Account registration also records the normalized email and subject snapshot in a directory event before the subject record, so a later lookup can recover a registration interrupted between those writes.

This is recoverable per record, not a cross-object transaction. Rotation, password reset, verification, and account registration can span multiple aggregates; a failure may leave an operation partially completed and must be retried or repaired according to the resulting event history. Event listing and identity lookup scan S3 objects, so cost grows with history. Enable bucket versioning and keep a separate backup before production writes.

The queue is not a distributed lock. The operating assumption is low-volume administration with changes issued one at a time. Vercel Functions can run invocations across multiple instances, so the local queue does not serialize every write globally; cross-instance write races remain an accepted residual risk under this operating assumption.
