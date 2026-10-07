# Application integration API

Perminister provides shared human identity and access checks for consumer applications. Each
application keeps its own branded experience, session cookie, domain data, and resource enforcement.

## Client credentials

Ask a Perminister platform operator to provision a client ID and secret for the application and bind
it to the product ID used in the Perminister catalog. The application backend sends these headers
when calling consumer endpoints:

```http
X-Perminister-Client-Id: <CLIENT_ID>
X-Perminister-Client-Secret: <CLIENT_SECRET>
```

Keep the client secret on the backend. Never include it in browser code, URLs, source control, or
logs.

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

Registration accepts `email` and `password`; the password must be 15–256 characters. It returns
`202` with the same accepted response for new and existing email addresses. A new account does not
gain organization access automatically; an invitation or organization manager must grant it.

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

A successful login returns a session token, stable subject ID, and the organizations where the
account can use this product:

```json
{
  "authenticated": true,
  "sessionToken": "<SESSION_TOKEN>",
  "account": { "subjectId": "<SUBJECT_ID>", "email": "person@example.com" },
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

An unverified account receives `403` with `{"error":"email_verification_required"}`. Verification
accepts either an `email` to request a link or a `token` to complete verification. Recovery accepts
either an `email` to request a link or a `token` and new `password` to complete recovery. A new
password must be 15–256 characters. Password change requires `currentPassword` and `newPassword`.
Requests by email return a generic accepted response to avoid revealing whether an account exists.
Password changes and recovery invalidate existing app sessions.

Store the session token in the application's own Secure, HttpOnly, SameSite cookie. Send it as a
bearer token, along with the client headers, when validating or revoking the session. Keep the token
out of browser JavaScript. Organization access is returned for the current session; use the selected
organization ID as a tenant key for application-owned records.

Product backends should protect public authentication routes, including sign-in, registration,
verification, and recovery, with rate limits and appropriate bot protection. The application owns
any branded verification or recovery completion pages; the Perminister platform operator configures
email delivery and link routing.

## Authorization

Call `POST /api/authorize` from the application backend with a user API key, app session token, or
service integration key:

```http
POST /api/authorize
Authorization: Bearer <TOKEN>
Content-Type: application/json
```

For an app session token, also send the client ID and secret headers above. The request identifies
the organization, product, resource, and exact action to check:

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
workspaces. The endpoint returns `200` with `{"authorized":true,...}` when access is allowed, `403`
when the token is invalid or out of scope, and `401` when bearer credentials are missing. Invalid
JSON or fields return `400`.

Perminister checks the requested action against the current membership, grant, and key scope. Product
grants can cover resources within the product; project and workspace grants must match the requested
resource. Product membership roles do not grant actions by themselves. The application must load
the requested resource, confirm its organization boundary, and enforce the decision on its own
server. Perminister does not fetch application data.

## Server integrations

Organization Owners and Admins can manage service integrations through the consumer-authenticated API.
Each request requires the client headers and a current app session bearer token. These records are
scoped to the authenticated product and organization:

- `GET /api/auth/consumer/integrations?organizationId=<ORGANIZATION_ID>` lists integrations.
- `POST /api/auth/consumer/integrations` creates one with `organizationId` and `name`.
- `PATCH /api/auth/consumer/integrations/{servicePrincipalId}` enables or disables it with an
  `enabled` boolean.
- `GET` and `POST` `/api/auth/consumer/integrations/{servicePrincipalId}/keys` list or create keys.
- `DELETE /api/auth/consumer/integrations/{servicePrincipalId}/keys/{apiKeyId}` revokes a key.

Key creation accepts `organizationId`, `scopeKind` (`product`, `project`, or `workspace`), optional
`resourceId`, `actions`, optional `expiresAt`, and optional `rotateFromApiKeyId`. A resource ID is
required for project and workspace scopes. The product ID is taken from the authenticated client.
The raw key is returned only when created. Use the narrowest scope and actions needed for the
background task.
