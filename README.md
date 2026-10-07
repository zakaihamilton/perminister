# Perminister

Perminister helps organizations manage products, product members, access grants, and API keys. Consumer applications keep their own sessions, domain data, and resource enforcement.

## Implemented flows

- Email/password registration, sign-in, sign-out, profile, 12-hour sessions, session revocation, email verification, and password recovery.
- Organization requests and approval, organization catalog managers, product-scoped Owner/Admin/Member roles, product invitations, and product/project/workspace permission grants.
- Product setup from a website URL, with optional Brave Search name lookup and editable metadata preview.
- API-key creation, one-time secret display, rotation, expiry, listing, revocation, and activity history.
- First-party product authentication APIs for registration, verified login, product-bound sessions, password recovery/change, and organization discovery.
- Product-scoped service principals and project/workspace API keys for server integrations.
- `GET /api/auth/session` for the Perminister browser session and `POST /api/authorize` for API-key and product-session checks.
- `GET /api/health` for process liveness and `GET /api/ready` for DigitalOcean Spaces readiness.

See [the API and operations guide](docs/api.md) for request details, setup, security boundaries, and storage operations. [The storage guide](docs/storage-layout.md) documents the direct JSON layout.

## Local setup

Copy `.env.example` to `.env.local`. Keep Spaces credentials and `PERMINISTER_IDENTITY_INDEX_SECRET` server-side; never use a `NEXT_PUBLIC_` prefix. Generate a stable random value of at least 32 characters for the identity index secret, for example with `openssl rand -base64 32`. Do not rotate it without rebuilding the email index.

The bucket endpoint, region, and bucket are set to `https://perminister.sfo3.digitaloceanspaces.com`, `sfo3`, and `perminister`. Set `PERMINISTER_ADMIN_EMAILS` only for restricted platform operations. For local email links, `PERMINISTER_PUBLIC_ORIGIN` defaults to `http://localhost:3000`.

To connect a product such as Visitoring or PostParticle, add its client ID to `PERMINISTER_APP_CLIENT_IDS` and configure the matching server-only secret, display name, product ID, and optional app origin. The client secret belongs only in the product backend. See [the consumer authentication contract](docs/api.md#consumer-application-authentication) for the login, session, organization-selection, authorization, and service-integration flow.

Email verification, password recovery, and invitations send through Resend's email API. Configure `RESEND_API_KEY` and `PERMINISTER_MAIL_FROM` with a sender accepted by a verified Resend domain. Browser-triggered links use the request origin; `PERMINISTER_PUBLIC_ORIGIN` is a fallback for server-to-server requests without a browser or product origin. See [the API contract](docs/api.md) for details.

Organization invitations also use Resend. Website import reads a product page's metadata server-side, and users review the suggested details before saving; no search credential is required.

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

## S3 object design

DigitalOcean Spaces is the only persistent store. Objects are written directly in the bucket root, organized by stable IDs, with no application-name or version prefix:

```text
subjects/{subjectId}.json
indexes/{lookupType}/{lookupKey}.json
orgs/{organizationId}/organization.json
orgs/{organizationId}/catalog-managers/{subjectId}.json
orgs/{organizationId}/products/{productId}/product.json
orgs/{organizationId}/products/{productId}/members/{subjectId}.json
orgs/{organizationId}/products/{productId}/invitations/{invitationId}.json
service-principals/{servicePrincipalId}.json
api-keys/{apiKeyId}.json
sessions/{sessionId}.json
email-actions/{actionId}.json
invitations/{invitationId}.json
activity/events/{date}/{timestamp}-{eventId}.json
```

Product membership roles and explicit permission grants are stored together in the product member document. User-key authorization reads the key, subject, organization, and product member directly; integration-key authorization reads the key, service principal, organization, and product. Neither path lists S3 objects or replays events. Compact activity documents support the organization and product activity views. HMAC email, subject lookup, and activity pointers are small indexes that can be rebuilt from canonical objects.

Product Owners and Admins manage product members, invitations, and grants. Only a Product Owner can change member roles or remove members, and every product keeps at least one Owner. A product role does not grant API actions. Organization catalog managers edit organization and product metadata; they are not automatically product members.

## Rebuild lookup indexes

The current application writes new data directly at the bucket root. To rebuild derived lookup and activity indexes, run a dry run first and then apply:

```sh
npm run storage:rebuild-indexes
npm run storage:rebuild-indexes -- --apply
```

## Operational limits

Mutations are serialized only within one Node.js process. Multiple Vercel instances can race on registration, product IDs, invitations, membership limits, and writes; Spaces is not a distributed lock or transaction coordinator. Object versioning and a separate backup are required for recovery. See the [operations guide](docs/api.md) for coordination and migration details.
