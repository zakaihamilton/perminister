# Application integration API

Perminister provides shared human identity and access checks for consumer applications. Each
application keeps its own branded experience, session cookie, domain data, and resource enforcement.
The paths below are relative to the Perminister base URL provided by the platform operator.

## Client credentials

Ask a Perminister platform operator to provision a client ID and secret for the application and bind
it to the product ID used in the Perminister catalog. The application backend sends these headers
when calling consumer endpoints:

```http
X-Perminister-Client-Id: <CLIENT_ID>
X-Perminister-Client-Secret: <CLIENT_SECRET>
```

Keep the client secret on the backend. Never include it in browser code, URLs, source control, or
logs. Consumer endpoints require these headers; `POST /api/authorize` requires them when the bearer
credential is an app session token. User-owned and service-principal API keys do not require client
headers for authorization.

JSON request bodies must use `Content-Type: application/json` and are limited to 8 KiB. Malformed
JSON and most invalid fields return `400`; email-only verification and recovery requests keep a
generic `202` response. Oversized bodies return `413`, and other content types return `415`.

## Consumer authentication

Consumer authentication endpoints are called by the application backend:

| Method   | Route                                   | Purpose                                                               |
| -------- | --------------------------------------- | --------------------------------------------------------------------- |
| `POST`   | `/api/auth/consumer/register`           | Create a central account and request email verification               |
| `POST`   | `/api/auth/consumer/login`              | Verify credentials and create an app-bound session                    |
| `GET`    | `/api/auth/consumer/session`            | Validate a session and return current account and organization access |
| `DELETE` | `/api/auth/consumer/session`            | Revoke the current app session                                        |
| `POST`   | `/api/auth/consumer/email-verification` | Request or complete email verification                                |
| `POST`   | `/api/auth/consumer/password-recovery`  | Request or complete password recovery                                 |
| `PATCH`  | `/api/auth/consumer/password`           | Change a password for the current session                             |

Registration accepts `email` and `password`; the password must be 15–256 characters. Optional
`firstName` and `lastName` fields may each contain up to 80 characters. The names are available in
authenticated account responses (`null` when unset) and can also be updated from the Perminister
profile page. The endpoint returns `202` with `{"accepted":true}` for both new and existing email
addresses. A new account does not gain organization access automatically; an invitation or
organization manager must grant it. Invalid registration fields return `400`; a temporary
registration service failure returns `503`.

Login accepts `email` and `password`. For example:

```http
POST /api/auth/consumer/login
X-Perminister-Client-Id: <CLIENT_ID>
X-Perminister-Client-Secret: <CLIENT_SECRET>
Content-Type: application/json
```

```json
{ "email": "person@example.com", "password": "<password>" }
```

A successful login returns a session token, stable subject ID, and the organization contexts
associated with the account for this product. The `permissions` field lists current action grants;
membership alone does not authorize an action:

```json
{
  "authenticated": true,
  "sessionToken": "<SESSION_TOKEN>",
  "account": {
    "subjectId": "<SUBJECT_ID>",
    "email": "person@example.com",
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
      "permissions": []
    }
  ]
}
```

Invalid credentials return `401` with `{"error":"invalid_credentials"}`. An unverified account
returns `403` with `{"error":"email_verification_required"}`. After eight failed attempts for an
email within 15 minutes, login is locked for 15 minutes and returns `429` with
`{"error":"too_many_attempts"}`. This login throttle is process-local, so product backends should
also apply their own rate limits. Authentication service failures return `503`.

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
