# Perminister API and operations

## Account interface

The web interface provides organization requests and switching, product and team management, access grants, API keys, profile, sessions, activity, and organization settings. New organizations stay pending until a configured platform administrator approves them; pending and rejected requests are visible to their requester, and rejected requesters may submit another request. Only approved organizations appear in the workspace switcher or allow dashboard and API access. Dashboard sections are separate pages under `/dashboard/{organizationId}`. Organization catalog managers manage organization and product metadata. Product Owners and Admins manage that product's invitations and grants; only Product Owners change product roles or remove members. Members can review their own product access and account pages. Only organization Owners manage catalog-manager roles and organization settings.

Registration creates a stable UUID identity and a salted scrypt password verifier. Passwords must be at least 15 characters. Email addresses are normalized to lowercase and looked up through a keyed HMAC index; the email address itself is not stored in an object key. Registration does not merge any existing application account. Because multiple app instances can write concurrently, Spaces alone cannot guarantee uniqueness during simultaneous registrations; a deployment-wide coordination layer is required if concurrent registration must be strictly unique. Email verification is sent when Resend is configured, but an unverified account can sign in. An emailed password-recovery link proves control of the registered address and verifies it if needed.

Perminister dashboard sessions use a random, opaque browser token in an HttpOnly, SameSite=Lax cookie; production cookies are Secure. Only a SHA-256 verifier is stored in Spaces. Sessions expire after 12 hours. Signing out revokes the current session. Changing a password increments the account auth version, invalidating every prior session. Server Actions perform their own authorization checks and use Next.js POST and Origin/Host protections. Product sessions are separate and are accepted by the bearer authorization API only when bound to the matching configured application client and product.

## Consumer application authentication

Visitoring, PostParticle, and other first-party product servers can authenticate users through Perminister while keeping their own branded login, registration, verification, and recovery screens. The flow is browser → product backend → Perminister. Only the trusted product backend calls these endpoints and sends the product credentials in `X-Perminister-Client-Id` and `X-Perminister-Client-Secret`; never put the client secret in browser code or logs. The product backend puts the returned session token in that product's own Secure, HttpOnly, SameSite cookie. Browser sessions remain independent between products.

Configure `PERMINISTER_APP_CLIENT_IDS` as a comma-separated allowlist. For each ID, configure `PERMINISTER_APP_CLIENT_{ID}_SECRET` with a random secret of at least 32 characters. For example, `visitoring` can be bound to product ID `visitoring`, and `postparticle` to `postparticle`. Product IDs are lowercased and must match the ID used in that organization's Perminister product catalog. The optional `PERMINISTER_APP_CLIENT_{ID}_ORIGIN` must be an HTTPS origin in production; verification and recovery emails then link to the product's `/auth/verify-email` and `/auth/reset-password` pages with a one-time token. Those pages submit the token to the corresponding Perminister endpoint. Without an app origin, email links use Perminister's own pages.

`POST /api/auth/consumer/register` accepts `email` and `password`. It creates one central identity and requests email verification, returning the same `202 {"accepted":true}` response for new and existing addresses. The endpoint does not join the new identity to an organization; an organization invitation or manager action grants that access.

`POST /api/auth/consumer/login` accepts `email` and `password`. A verified account receives an opaque 12-hour `sessionToken`, the stable `subjectId`, and the organizations where that account is an active member and the configured product exists. The response includes the product-specific permissions for each organization. The product backend should set its own Secure, HttpOnly, SameSite cookie containing the session token and keep the token out of browser JavaScript. `GET /api/auth/consumer/session` validates that token and returns the current account and eligible organizations. `DELETE` on the same path revokes it. Password reset and password change increment the account auth version and invalidate every product session.

The product backend sends login requests like this:

```http
POST /api/auth/consumer/login
X-Perminister-Client-Id: visitoring
X-Perminister-Client-Secret: <server-only-secret>
Content-Type: application/json
```

```json
{ "email": "person@example.com", "password": "<password>" }
```

The response includes `account.subjectId` and an `organizations` array with each organization's ID, display name, role, product ID, and scoped permission grants. Store `sessionToken` in the product's HttpOnly cookie; use `subjectId` and the selected `organizationId` as the stable identity and tenant keys in product-owned records. An unverified account receives `403` with `{"error":"email_verification_required"}`.

`POST /api/auth/consumer/email-verification` accepts either an `email` to request a verification email or a `token` to complete verification. `POST /api/auth/consumer/password-recovery` accepts either an `email` to request recovery or a `token` and new `password` to complete it. Requests by email return a generic accepted response to avoid account enumeration. `PATCH /api/auth/consumer/password` requires the product session plus `currentPassword` and `newPassword`.

Product backends should rate-limit public registration, verification, and recovery requests and add bot protection where appropriate. Perminister throttles failed sign-ins in process memory; like other process-local limits, it is not shared across deployment instances.

The product stores its own profile/preferences and domain data, keyed by Perminister's `subjectId` and the active `organizationId`. It does not create a second password account or treat matching email addresses as linked identities. The app session is product-bound, but organization access is checked separately so a person can switch among organizations that use the same product. The product must still tenant-scope every resource lookup and enforce the authorization decision against its own data. Perminister does not automatically migrate or merge existing Visitoring/PostParticle accounts; each product needs an explicit verified migration or account-linking flow before replacing its current login.

## Authorization endpoint

`POST /api/authorize` checks a high-entropy API key against its own scope and actions, then checks the active product membership and explicit grants for user-owned keys. It also accepts a product-bound consumer session token when the matching application client headers are present, and service-principal keys for background work. Requests for pending or rejected organizations are denied. Send a bearer token and JSON:

```http
POST /api/authorize
Authorization: Bearer pmk_<api-key-uuid>_<secret>
Content-Type: application/json
```

For a product session, send the same request with `Authorization: Bearer <sessionToken>` and both `X-Perminister-Client-Id` and `X-Perminister-Client-Secret` headers from the product backend.

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

An accepted user request returns `200` with `{"authorized":true,"subjectId":"..."}`. An accepted service-key request returns `{"authorized":true,"servicePrincipalId":"..."}`. A denied, expired, revoked, unknown, or out-of-scope token returns `403` with `{"authorized":false}`. Invalid JSON or fields return `400`; missing bearer credentials return `401`. Responses are not cached. Consumer applications must still load and authorize their own domain resource on their server; the endpoint does not fetch consumer data.

Organization Owners and Admins can manage server integrations through the consumer-authenticated API. These integration records are scoped to the authenticated product and organization. `GET /api/auth/consumer/integrations?organizationId=...` lists that product's integrations; `POST` to the same route creates one with `organizationId` and `name`. `PATCH /api/auth/consumer/integrations/{servicePrincipalId}` enables or disables an integration. Disabling it revokes its active keys.

`GET` and `POST /api/auth/consumer/integrations/{servicePrincipalId}/keys` list keys or create a key. Creation accepts `organizationId`, `scopeKind` (`product`, `project`, or `workspace`), optional `resourceId`, `actions`, and `expiresAt`; it may also accept `rotateFromApiKeyId` to rotate an existing key. The configured consumer product ID is applied by Perminister. The raw secret is returned only in the create response. `DELETE /api/auth/consumer/integrations/{servicePrincipalId}/keys/{apiKeyId}` revokes a key. For telemetry writers, use a project-scoped key with a narrow action such as `telemetry:write`.

For example, add both `visitoring` and `postparticle` products under Sentry8, add `visitoring` under My Projects, and add `visitoring` under Yochanan. Create an integration under each organization. Under My Projects, issue separate project-scoped `telemetry:write` keys for ShiftingFront, Puzzimori, and HostPresent; those projects can share an integration principal while each key remains limited to its project. All three Visitoring products use the same configured `visitoring` product ID while their organization IDs, memberships, grants, integration principals, and keys remain separate.

`GET /api/auth/session` returns the current account and session expiry for the browser session cookie. It returns `401` when the session is absent or invalid. `GET /api/health` checks process liveness only. `GET /api/ready` makes a limited read request to the configured Spaces bucket and returns `503` when the required storage is unavailable.

## Administration

Set `PERMINISTER_ADMIN_EMAILS` to a comma-separated list of account email addresses for restricted platform operations. This setting is checked on each request and is not stored as an organization role. Platform administrators can review organization requests, manage account status, and retire legacy unscoped grants and keys. One pending organization request is allowed per requesting account. That check uses the process-local mutation queue and can race across separate app instances because Spaces provides no distributed lock. Organization Owners and Admins manage the catalog; only Owners manage catalog-manager roles and organization settings. Product Owners and Admins manage product invitations and grants; only Product Owners change product roles or remove product members. A configured administrator cannot disable its own configured address; remove an address from the environment setting first if it must be disabled.

Organizations, product memberships, products, invitations, and identity/access records are stored as schema-versioned JSON objects directly under the bucket root. Product IDs are unique within an organization, so two organizations may use the same product ID. API-key and grant scopes include the organization ID; `POST /api/authorize` requires it and checks the matching organization, product, resource, action, active membership, and explicit grant. Current records are the source of truth; activity entries are compact audit metadata and are not replayed to construct current state.

Product website lookups require an owner/admin session and are limited to 10 requests per minute per person and organization per app process. Sign-in throttling reserves capacity for pending checks and counts failures within a 15-minute window. An email is locked for 15 minutes after its eighth failed check. These limits apply per app process and are not shared between app instances.

The Platform operations page includes an idempotent legacy-access migration. It disables active grants without an organization scope and revokes active API keys without an organization scope. It preserves identities, sessions, and audit history. Users then create new grants and keys within an organization. Review the preview counts before running it; rerunning the migration changes no further records once unscoped access has been retired.

Each account can manage its own API keys, including expiry, revocation, and rotation. A raw API key is returned only in the create action response and is never stored. Rotation writes the replacement key first, then revokes the old one; if the second write fails, the dashboard returns the new key with a warning to revoke the old one manually.

## Resend email delivery

The server sends directly to Resend's `POST https://api.resend.com/emails` endpoint; no relay adapter or SDK dependency is needed. Configure `RESEND_API_KEY` with a server-side Resend API key and `PERMINISTER_MAIL_FROM` with a sender address accepted by the Resend account. Browser-triggered links use the request's `Origin` header. For server-to-server consumer authentication requests that have no browser or product origin, set `PERMINISTER_PUBLIC_ORIGIN` as the fallback. Use a sender address under a verified Resend domain for production.

Each request uses bearer authentication and JSON fields `from`, `to`, `subject`, `text`, and `html`. The API accepts the `to` value as a single address; the application considers a 2xx response accepted and does not parse the returned message ID. The request times out after 10 seconds. Missing configuration, network errors, or non-2xx responses produce a message that no email was sent. Password recovery sends a one-time link to an active account's registered address; completing the reset proves control of that address and verifies it if needed. One-time links expire after 30 minutes and are stored as digests.

Organization invitations also use Resend and expire after seven days. The invitation link is bound to the invited email address; accepting it verifies that address if it was not already verified.

When used, `PERMINISTER_PUBLIC_ORIGIN` may use `http://localhost` or `http://127.0.0.1` in local development. Production origins must use HTTPS.

## Environment

| Variable                                 | Required           | Purpose                                                                                           |
| ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `PERMINISTER_SPACES_ENDPOINT`            | Yes                | Bucket endpoint, `https://perminister.sfo3.digitaloceanspaces.com`                              |
| `PERMINISTER_SPACES_REGION`              | Yes                | Spaces region, `sfo3`                                                                           |
| `PERMINISTER_SPACES_BUCKET`              | Yes                | Private bucket, `perminister`                                                                   |
| `PERMINISTER_SPACES_ACCESS_KEY`          | Yes                | Server-side Spaces access key                                                                   |
| `PERMINISTER_SPACES_SECRET_KEY`          | Yes                | Server-side Spaces secret key                                                                   |
| `PERMINISTER_IDENTITY_INDEX_SECRET`      | Yes                | Stable random secret, at least 32 characters, for HMAC email lookup; rebuild indexes to rotate it |
| `PERMINISTER_ADMIN_EMAILS`               | For administration | Comma-separated admin account email addresses                                                   |
| `PERMINISTER_APP_CLIENT_IDS`             | For product auth   | Comma-separated first-party product client IDs                                                  |
| `PERMINISTER_APP_CLIENT_{ID}_SECRET`     | For product auth   | Server-only client secret, at least 32 characters, for each configured client ID                |
| `PERMINISTER_APP_CLIENT_{ID}_NAME`       | Optional           | Product name used in verification and recovery emails; defaults to the client ID                |
| `PERMINISTER_APP_CLIENT_{ID}_PRODUCT_ID` | Optional           | Product ID bound to that client; defaults to its client ID                                      |
| `PERMINISTER_APP_CLIENT_{ID}_ORIGIN`     | Optional           | HTTPS app origin for product-branded verification and recovery links                            |
| `PERMINISTER_PUBLIC_ORIGIN`              | Optional fallback | Origin for server-to-server email links without a browser or product origin                    |
| `RESEND_API_KEY`                         | For email delivery | Server-side Resend API key; never expose to browser code                                        |
| `PERMINISTER_MAIL_FROM`                  | For email delivery | Sender address accepted by Resend; use a verified domain in production                          |
| `BRAVE_SEARCH_API_KEY`                   | For name search    | Optional server-side Brave Search subscription token; direct URL import does not require it    |

There is no session signing secret: browser tokens are generated independently with 256 bits of randomness, and only their digests are persisted. Keep `.env.local` out of source control and use Vercel's environment settings for Vercel values.

## Mutation coordination and recovery

Mutations run through a process-local `SingleWriterMutationQueue` and organization-local lock. They serialize work inside one Node.js process only. A canonical record update replaces its JSON object; compact activity metadata is appended separately. Small by-ID, by-subject, email, and activity pointers support lookups and listings. The canonical record write is the commit point: its derived lookup indexes are written first, and an activity append failure after commit is logged without reporting the mutation itself as failed. These indexes are derived data and can be rebuilt from canonical objects and activity records with `npm run storage:rebuild-indexes` (dry run by default).

Spaces does not provide a conditional cross-object transaction or a distributed lock. A multi-object action can stop partway through, and separate app instances can race on product uniqueness, owner-role limits, invitations, grants, API keys, and account registration. An index write failure prevents the canonical commit, though it may leave harmless or stale pointers; an activity append failure after the canonical commit is logged, and the mutation remains successful. Rebuilding indexes cannot recreate a missing audit event. Enable bucket versioning and keep a separate backup before production writes. Keep the index HMAC secret stable; changing it requires rebuilding the email index before deployments use the new value.

Bearer API-key authorization reads four canonical objects per request. User-owned keys read the key, subject, organization, and product membership; service keys read the key, service principal, organization, and product. The product membership contains explicit grants, so these authorization paths do not list objects or read activity history. The modeled benchmark confirms four object reads and zero list requests as activity history grows; actual Spaces latency depends on network and bucket response time. Consumer-session checks use their own session validation path.

### Recovering partial writes

1. Pause writes on every app instance and take a separate bucket backup. Keep Spaces object versioning enabled so earlier versions of overwritten JSON objects remain available.
2. Inspect the relevant canonical objects under the bucket-root data folders, their object versions, and recent activity records. Activity is an audit aid; it is not a full copy of the previous record.
3. If canonical data is correct but a lookup or activity view is incomplete, run `npm run storage:rebuild-indexes` and review the dry-run counts. Apply the rebuild only after confirming it will repair the affected indexes.
4. If a canonical record needs restoration, restore the verified prior object version from the bucket backup/version history, then rebuild derived indexes. Do not infer current state from the activity stream.
5. Verify sign-in, account lookup, product membership, authorization, and activity views before resuming writes.
