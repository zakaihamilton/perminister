# Application integration API

Perminister provides shared human identity and access checks for consumer applications. Each
application keeps its own branded experience, session cookie, domain data, and resource enforcement.
The paths below are relative to the Perminister base URL provided by the platform operator.

## Client credentials

Product owners and admins create an app client from the product’s **App clients** page. Each client
is bound to that product and has its own session lifetime, optional app origin, and self-registration
setting. Perminister returns the client ID and secret once; copy them into the
application backend’s environment. Owners and admins can rotate or revoke credentials from the same
page. Rotating a secret immediately invalidates the previous one, and revoking a client stops its
credentials from working. Set the exact canonical product origin to enable Sign in with Perminister.
The SSO callback path is `/auth/perminister/callback`. The application backend sends these headers when calling consumer
endpoints:

```http
X-Perminister-Client-Id: <CLIENT_ID>
X-Perminister-Client-Secret: <CLIENT_SECRET>
```

Keep the client secret on the backend. Never include it in browser code, URLs, source control, or
logs. Consumer endpoints require these headers; `POST /api/authorize` requires them when the bearer
credential is an app session token. User-owned and service-principal API keys do not require client
headers for authorization.

## Product catalog and sharing

Products are private to their organization when created. An organization owner or admin can make a
product public from its details page. Owners and admins in other approved organizations can then add
it from their **Products** page without recreating its product ID or configuration. Product details
and access role templates come from the publishing organization and stay in sync; each organization
keeps its own members, access grants, app clients, integrations, and API keys. A different product
with the same ID blocks an install until that conflict is resolved. Making a shared product private
removes its installations from other organizations and revokes their product-scoped access and
credentials.

JSON request bodies must use `Content-Type: application/json`. Most are limited to 8 KiB; consumer
member and account management requests allow 16 KiB, and the legacy import allows 25 MiB. Malformed
JSON and most invalid fields return `400`; email-only verification and recovery requests keep a
generic `202` response. Oversized bodies return `413`, and other content types return `415`.

## Consumer authentication

Consumer authentication endpoints are called by the application backend:

| Method   | Route                                   | Purpose                                                               |
| -------- | --------------------------------------- | --------------------------------------------------------------------- |
| `POST`   | `/api/auth/consumer/register`           | Create a central account and request email verification               |
| `POST`   | `/api/auth/consumer/login`              | Verify credentials and create an app-bound session                    |
| `POST`   | `/api/auth/consumer/token`              | Exchange a one-time SSO authorization code for an app-bound session   |
| `GET`    | `/api/auth/consumer/session`            | Validate a session and return current account and organization access |
| `DELETE` | `/api/auth/consumer/session`            | Revoke the current app session                                        |
| `POST`   | `/api/auth/consumer/email-verification` | Request or complete email verification                                |
| `POST`   | `/api/auth/consumer/password-recovery`  | Request or complete password recovery                                 |
| `PATCH`  | `/api/auth/consumer/password`           | Change a password for the current session                             |

### Sign in with Perminister

The product backend starts an authorization-code flow at `/oauth/authorize` with its client ID,
exact callback URI, random `state`, and an S256 PKCE challenge. The callback URI must use the
registered app origin and the fixed `/auth/perminister/callback` path. Perminister asks the signed-in
person to confirm, then redirects back with a short-lived code and the original state. The backend
checks the state and exchanges the code at `POST /api/auth/consumer/token`, sending its app-client
headers and a `grant_type` of `authorization_code`, the code, and its original PKCE verifier. Codes
expire after five minutes, are bound to the app client, and can be exchanged once. The exchange
returns the same app-bound session shape as password login; store that token in the product's own
Secure, HttpOnly, SameSite cookie.

Registration accepts `email` and `password`; the password must be 15–256 characters. Optional
`firstName` and `lastName` fields may each contain up to 80 characters. The names are available in
authenticated account responses (`null` when unset) and can also be updated from the Perminister
profile page. Public self-registration is disabled by default for new clients. It stays disabled for
Visitoring and PostParticle, whose accounts are provisioned by product administrators. For other
products, an owner or admin can enable it in the client settings; otherwise `/register` returns
`403`. When enabled, the endpoint returns `202` with `{"accepted":true}` for both new and existing
email addresses. A new account does not gain organization access automatically; an invitation or
organization manager must grant it. Invalid registration fields return `400`; a temporary
registration service failure returns `503`.

Login accepts `identifier` and `password`; `email` remains supported for existing clients. The
identifier can be an email for any consumer, or a product-scoped username for PostParticle. Login
accepts passwords up to 1,024 characters so existing Visitoring credentials remain usable; new,
changed, and recovered passwords still use the 15–256 character policy. For example:

```http
POST /api/auth/consumer/login
X-Perminister-Client-Id: <CLIENT_ID>
X-Perminister-Client-Secret: <CLIENT_SECRET>
Content-Type: application/json
```

```json
{ "identifier": "person@example.com", "password": "<password>" }
```

A successful login returns a session token, stable subject ID, and the organization contexts
associated with the account for this product. `account.email` and `account.username` are nullable;
`loginIdentifier` is the identifier sent by the caller. Each organization includes `resourceRoles`
for its workspace or project grants and a `platformAdmin` flag. The `permissions` field lists
current action grants; membership alone does not authorize an action:

```json
{
  "authenticated": true,
  "sessionToken": "<SESSION_TOKEN>",
  "account": {
    "subjectId": "<SUBJECT_ID>",
    "email": "person@example.com",
    "username": null,
    "loginIdentifier": "person@example.com",
    "firstName": "Alex",
    "lastName": "Morgan"
  },
  "session": { "expiresAt": "<TIMESTAMP>" },
  "organizations": [
    {
      "organizationId": "<ORGANIZATION_ID>",
      "organizationName": "Example",
      "organizationRole": "member",
      "productId": "<PRODUCT_ID>",
      "permissions": [],
      "resourceRoles": [],
      "platformAdmin": false
    }
  ]
}
```

Invalid credentials return `401` with `{"error":"invalid_credentials"}`. A new self-service
account with an unverified email returns `403` with `{"error":"email_verification_required"}`;
imported and administrator-provisioned accounts do not require email verification. After eight
failed attempts for an identifier within 15 minutes, login is locked for 15 minutes and returns `429` with
`{"error":"too_many_attempts"}`. This login throttle is process-local, so product backends should
also apply their own rate limits. Authentication service failures return `503`.

Each app client stores its configured session lifetime (5 minutes through 90 days). Set Visitoring
to 30 days and PostParticle to 8 hours when creating those clients. Keep the returned token in the
app's Secure, HttpOnly, SameSite cookie.

Use `GET /api/auth/consumer/session` with the client headers and session bearer token to validate the
session. A successful response contains `authenticated: true`, the same `account` and organization
context data as login, and a `session` object with `createdAt` and `expiresAt`; it does not return the
token again. The organization list is context, not an authorization decision; use
`POST /api/authorize` for protected operations. Missing, invalid, expired, or revoked sessions
return `401` with `{"authenticated":false}`. A service error returns `503`.

Use `DELETE /api/auth/consumer/session` with the client headers and current session bearer token to
revoke it. A completed request returns `{"signedOut":true}`. The response is also returned when the
bearer token is absent or no longer valid; include the token to revoke an active session. A session
service failure returns `503`.

`POST /api/auth/consumer/email-verification` accepts either `{"email":"person@example.com"}` to
request a link or `{"token":"<VERIFICATION_TOKEN>"}` to complete verification. Email requests
return `202` with `{"accepted":true}` regardless of whether the address has an account. A valid token
returns `200` with `{"verified":true}`; an invalid or expired token returns `400`. A token-processing
service error returns `503`.

`POST /api/auth/consumer/password-recovery` accepts either an email to request a link or a token and
new password to complete recovery:

```json
{ "token": "<RECOVERY_TOKEN>", "password": "<new-password>" }
```

Email requests return `202` with `{"accepted":true}` regardless of whether the address has an
account. A valid token returns `200` with `{"passwordChanged":true}`; a new password must be 15–256
characters, and an invalid or expired token returns `400`. A token-processing service error returns
`503`. Recovery lookups and email delivery run after the response.

`PATCH /api/auth/consumer/password` requires the client headers, a current session bearer token, and
`{"currentPassword":"<current-password>","newPassword":"<new-password>"}`. A successful response
is `{"passwordChanged":true,"allSessionsRevoked":true}`. An incorrect current password returns
`403`; invalid input returns `400`, and a service error returns `503`. Password changes invalidate
existing app sessions.

Recovery requests are throttled per process: three requests per email per rolling hour and 300 per
API client per rolling hour. First-party requests also have a 30-per-caller hourly limit when the
deployment supplies a recognized client IP through proxy headers; the email limit still applies
without one. These limits are best-effort process-local controls. Product backends should also
protect public authentication flows, including sign-in, registration, verification, and recovery,
with rate limits and appropriate bot protection.

Store the session token in the application's own Secure, HttpOnly, SameSite cookie. Keep it out of
browser JavaScript. The application owns any branded verification or recovery completion pages; the
Perminister platform operator configures email delivery and link routing.

## Consumer member management

Member management requests use the client ID and secret headers plus the acting user's current
consumer session bearer token. The session must belong to that client and its configured product.
Perminister checks the actor's active grant on the requested resource for every operation.

Visitoring members use workspace scopes and `viewer` or `admin` roles. `viewer` grants
`visitoring:workspace:read`; `admin` also grants `visitoring:members:manage`. PostParticle members use
project scopes and `viewer`, `editor`, or `admin` roles. `viewer` grants
`postparticle:project:read`; `editor` also grants `postparticle:project:write`; `admin` also grants
`postparticle:members:manage`. A PostParticle platform admin has a product-scope grant for project
read/write, member management, and `postparticle:accounts:manage` across that organization's projects.
Visitoring prevents an administrator from removing or demoting themself and keeps at least one active
administrator in each workspace.

| Method   | Route                                                                                | Purpose                                                  |
| -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `GET`    | `/api/auth/consumer/members?organizationId=<ID>&scopeKind=workspace&resourceId=<ID>` | List Visitoring workspace members                        |
| `GET`    | `/api/auth/consumer/members?organizationId=<ID>&scopeKind=project&resourceId=<ID>`   | List PostParticle project members                        |
| `POST`   | `/api/auth/consumer/members`                                                         | Provision an account if needed and grant a resource role |
| `PATCH`  | `/api/auth/consumer/members/{subjectId}`                                             | Change the scoped role/status or reset its password      |
| `DELETE` | `/api/auth/consumer/members/{subjectId}`                                             | Disable membership in the supplied scope                 |

For `POST`, send `organizationId`, `scopeKind`, `resourceId`, `role`, and an `email` or `username`.
Include `password` to provision a new account; the password must be 15–256 characters. An existing
central account keeps its current password even if a password is included; the response's
`accountCreated` is `false` and the request only adds or updates the scoped membership. This lets an
app attach an existing shared identity without resetting its credentials. Administrator-provisioned
accounts are exempt from email verification. A new PostParticle account or username must be created
by a platform admin.

`PATCH` and `DELETE` also require `organizationId`, `scopeKind`, and `resourceId`. `PATCH` accepts
any non-empty combination of `role`, `status` (`active` or `disabled`), and `password`. Password
resets invalidate all of the subject's sessions by advancing its authentication version. Scoped
application administrators can reset passwords only when the identity is not linked to another
product. For a shared identity, the account owner must use Perminister's password recovery or change
flow. `DELETE` disables only the membership grant for that resource; it does not disable the account.
Visitoring will reject a change that leaves a workspace without an active administrator. These routes
return `401` for invalid client credentials or sessions, `403` for insufficient permissions or
self-change restrictions, `404` for a missing resource/member, `409` for identity conflicts, and `400`
for invalid fields.

PostParticle platform admins also have product-wide account controls. These endpoints use the same
client and session headers, and the actor needs `postparticle:accounts:manage` in the supplied
organization:

| Method  | Route                                             | Purpose                                                           |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`   | `/api/auth/consumer/accounts?organizationId=<ID>` | List PostParticle accounts                                        |
| `POST`  | `/api/auth/consumer/accounts`                     | Create/link a username and provision an account                   |
| `PATCH` | `/api/auth/consumer/accounts/{subjectId}`         | Enable/disable an account, reset its password, or revoke sessions |

Account creation accepts `organizationId`, `username`, `password`, optional `email`, and optional
`platformAdmin`. Email may be omitted. If the email already identifies a central account, Perminister
links the product username to that identity and retains its current password; the response has
`created: false`. A platform admin can use `platformAdmin: true` to provision another platform admin.
Account updates accept `organizationId` plus one or more of `status`, `password`,
`revokeSessions: true`, and `platformAdmin` (`true` to grant or `false` to revoke platform-admin
access). `status` applies to PostParticle, so disabling PostParticle access does not disable that
person's shared identity in Visitoring. Disabling or enabling PostParticle access and `revokeSessions`
invalidate PostParticle sessions. Passwords belong to the shared identity, so resetting one invalidates
sessions in both apps. Application administrators cannot reset a password for an identity linked to
another product; the account owner must use Perminister's password recovery or change flow. An
administrator cannot change their own global account here.

## Legacy account import

The one-time import accepts an exported identity and membership manifest at
`POST /api/auth/consumer/migrations/legacy`. Configure `PERMINISTER_LEGACY_IMPORT_SECRET` with a
random secret of at least 32 characters and send it as `X-Perminister-Migration-Secret`. This route
does not accept consumer client credentials or a user session. Keep the migration secret and input
manifest server-side; the manifest contains password hashes. Create an active app client for each
product being imported before starting the import.

Example dry-run request (replace the hash placeholders with the exact exported hashes):

```json
{
  "dryRun": true,
  "visitoring": {
    "organizationId": "<PERMINISTER_ORGANIZATION_UUID>",
    "users": [
      {
        "id": "visitor-user-id",
        "email": "person@example.com",
        "passwordHash": "<argon2id-phc-hash>"
      }
    ],
    "memberships": [{ "userId": "visitor-user-id", "workspaceId": "workspace-1", "role": "admin" }]
  },
  "postparticle": {
    "organizationId": "<PERMINISTER_ORGANIZATION_UUID>",
    "users": [
      {
        "username": "writer",
        "email": "person@example.com",
        "passwordHash": "<32-hex-salt>:<128-hex-hash>"
      }
    ],
    "memberships": [{ "username": "writer", "projectId": "project-1", "role": "editor" }]
  }
}
```

Send `dryRun: true` first. Visitoring user records contain source `id`, `email`, and Argon2id PHC
`passwordHash` values; workspace memberships contain `userId`, `workspaceId`, `role` (`admin` or
`viewer`), and optional `active`. PostParticle user records contain `username`, optional `email`,
legacy `passwordHash` in `salt:hex-scrypt` format, and optional `platformAdmin`/`disabled` flags
(`disabled` applies to PostParticle only, even when the email is shared with Visitoring);
project memberships contain `username`, `projectId`, and `role` (`admin`, `editor`, `viewer`, or
`null`). The organization ID in each section must identify an approved Perminister organization
that already has the corresponding configured product. App data itself is not imported.

The response reports identity and membership counts, validation errors, and credential conflicts.
Visitoring users with the same normalized email are merged and each workspace membership is attached
to the shared identity. PostParticle accounts with a shared normalized email join the same identity;
accounts without one remain separate and keep a product-scoped username. If hashes differ, no records
are written until each conflict is resolved. The conflict report's candidate references can be sent
back under `credentialSelections`, keyed by the reported identity (for example,
`email:person@example.com`) and set to one candidate such as `visitoring:legacy-id` or
`postparticle:writer`. A `perminister:<subjectId>` candidate is also offered when an existing
Perminister credential conflicts. The report never returns raw hashes.

After resolving all conflicts, submit the same manifest with `dryRun: false`. Imported credentials
remain usable and are rehashed to Perminister's current password format after successful sign-in.
Imported accounts bypass email verification. Repeating an identical import is idempotent. An invalid
migration secret returns `401`; an unconfigured importer returns `503`; invalid manifests return
`400`; unresolved credential conflicts return `409` on apply (dry runs return the conflict report
with `200`). The v1 import and auth service assume one active Perminister process.

## Authorization

Call `POST /api/authorize` from the application backend with a user-owned API key, app session token,
or service-principal key:

```http
POST /api/authorize
Authorization: Bearer <TOKEN>
Content-Type: application/json
```

For an app session token, also send the client ID and secret headers above. The request identifies the
organization, product, resource, and exact action to check:

```json
{
  "organizationId": "<ORGANIZATION_ID>",
  "productId": "<PRODUCT_ID>",
  "resourceKind": "project",
  "resourceId": "project-id",
  "action": "read:profile"
}
```

`resourceKind` is `product`, `project`, or `workspace`. A `resourceId` is required for projects and
workspaces. A successful authorization returns `200` with `{"authorized":true,...}` and a
`subjectId` or `servicePrincipalId`. A missing or malformed bearer header returns `401`; a bearer
token that is present but invalid, denied, or out of scope returns `403` with `{"authorized":false}`.
Invalid JSON or fields return `400`, oversized bodies return `413`, and a non-JSON content type
returns `415`. A temporary service failure returns `503`.

For app session tokens and user-owned API keys, Perminister checks session or account validity,
active product membership, and current grants on each request. User-owned API keys also require an
active, verified account. Product membership roles alone do not grant actions. For a
service-principal key, Perminister checks the key's active and unexpired state, its configured
actions and scope, and whether its service principal is active. A service-principal key does not
depend on the creator's current grants after it is issued. Product scopes cover resources within
that product; project and workspace scopes must match the requested resource.

Only treat a request as authorized when the response is `200` with `authorized: true`. Deny the
protected operation on every other status, a false decision, or a timeout. The application must
load the requested resource, confirm its organization boundary, and enforce the decision on its own
server. Perminister does not fetch application data.

## Server integrations

Organization Owners and Admins can manage service integrations through the consumer-authenticated
API. Each request requires the client headers and a current app session bearer token. These records
are scoped to the authenticated product and organization:

- `GET /api/auth/consumer/integrations?organizationId=<ORGANIZATION_ID>` returns
  `{"integrations":[...]}`.
- `POST /api/auth/consumer/integrations` accepts `organizationId` and `name`, then returns
  `201` with `{"integration":...}`.
- `PATCH /api/auth/consumer/integrations/{servicePrincipalId}` accepts
  `{"status":"active"}` or `{"status":"disabled"}` and returns `{"updated":true}`.
- `GET /api/auth/consumer/integrations/{servicePrincipalId}/keys` returns
  `{"keys":[...]}` without raw key tokens.
- `POST /api/auth/consumer/integrations/{servicePrincipalId}/keys` creates a key and returns
  `201` with key metadata and its one-time token.
- `DELETE /api/auth/consumer/integrations/{servicePrincipalId}/keys/{apiKeyId}` revokes a key and
  returns `{"revoked":true}`.

An integration record includes its `servicePrincipalId`, organization and product IDs, name, status,
and timestamps. Key-list entries expose `apiKeyId`, `keyClass`, scope, actions, status, creation and
expiration times, revocation time, and the rotated-from key ID; they never include the raw token.
Creating a key returns this public metadata under `key`, along with `token` and a nullable
`rotationWarning`.

Integration names must be 2–80 characters. Key creation accepts `organizationId`, `scopeKind`
(`product`, `project`, or `workspace`), `actions`, optional `resourceId`, optional future
`expiresAt`, and optional `rotateFromApiKeyId`. A resource ID is required for project and workspace
scopes. The product ID is taken from the authenticated client. Use a non-empty list of at most 32
actions and the narrowest scope and actions needed for the background task. Omit `expiresAt` or set
it to `null` for a key without an expiration.

The key creation response contains `key` metadata, the raw `token`, and `rotationWarning`. The raw
token is shown only in this creation response; store it securely then. Supplying
`rotateFromApiKeyId` creates a replacement and attempts to revoke the previous active key. If that
revocation fails, `rotationWarning` explains that the prior key must be revoked separately.

Disabling a service integration revokes all of its active keys. Re-enabling the integration does not
restore those keys; create new keys for it. Invalid bodies return `400`, missing or invalid client
credentials or sessions return `401`, insufficient organization permissions return `403`, missing
resources return `404`, oversized bodies return `413`, unsupported content types return `415`, and
temporary service failures return `503` where applicable.
