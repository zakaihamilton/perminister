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

See [the API and operations guide](docs/api.md) for request details, setup, security boundaries, and storage operations. [The v1-to-v2 storage guide](docs/v1-contract.md) documents the direct JSON layout and migration.

## Local setup

Copy `.env.example` to `.env.local`. Keep Spaces credentials and `PERMINISTER_IDENTITY_INDEX_SECRET` server-side; never use a `NEXT_PUBLIC_` prefix. Generate a stable random value of at least 32 characters for the identity index secret, for example with `openssl rand -base64 32`. Do not rotate it without rebuilding the email index.

The bucket endpoint, region, and bucket are set to `https://perminister.sfo3.digitaloceanspaces.com`, `sfo3`, and `perminister`. Set `PERMINISTER_ADMIN_EMAILS` only for restricted platform operations. For local email links, `PERMINISTER_PUBLIC_ORIGIN` defaults to `http://localhost:3000`.

To connect a product such as Visitoring or PostParticle, add its client ID to `PERMINISTER_APP_CLIENT_IDS` and configure the matching server-only secret, display name, product ID, and optional app origin. The client secret belongs only in the product backend. See [the consumer authentication contract](docs/api.md#consumer-application-authentication) for the login, session, organization-selection, authorization, and service-integration flow.

Email verification, password recovery, and invitations send through Resend's email API. Configure `RESEND_API_KEY` and `PERMINISTER_MAIL_FROM` with a sender accepted by a verified Resend domain. Browser-triggered links use the request origin; `PERMINISTER_PUBLIC_ORIGIN` is a fallback for server-to-server requests without a browser or product origin. See [the API contract](docs/api.md) for details.

Organization invitations also use Resend. Website import is available without search credentials. To search product names, set `BRAVE_SEARCH_API_KEY`; search happens on the server and users review the suggested website and metadata before saving.

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

## S3 object design

DigitalOcean Spaces is the only persistent store. Current records are ordinary JSON objects organized by stable IDs:

```text
perminister/v2/subjects/{subjectId}.json
perminister/v2/orgs/{organizationId}/organization.json
perminister/v2/orgs/{organizationId}/catalog-managers/{subjectId}.json
perminister/v2/orgs/{organizationId}/products/{productId}/product.json
perminister/v2/orgs/{organizationId}/products/{productId}/members/{subjectId}.json
perminister/v2/orgs/{organizationId}/products/{productId}/invitations/{invitationId}.json
perminister/v2/service-principals/{servicePrincipalId}.json
perminister/v2/api-keys/{apiKeyId}.json
perminister/v2/sessions/{sessionId}.json
perminister/v2/email-actions/{actionId}.json
perminister/v2/activity/events/{date}/{timestamp}-{eventId}.json
```

Product membership roles and explicit permission grants are stored together in the product member document. User-key authorization reads the key, subject, organization, and product member directly; integration-key authorization reads the key, service principal, organization, and product. Neither path lists S3 objects or replays events. Compact activity documents support the organization and product activity views. HMAC email, subject lookup, and activity pointers are small indexes that can be rebuilt from canonical objects.

Product Owners and Admins manage product members, invitations, and grants. Only a Product Owner can change member roles or remove members, and every product keeps at least one Owner. A product role does not grant API actions. Organization catalog managers edit organization and product metadata; they are not automatically product members.

## Migrate an existing v1 bucket

The new application reads and writes `perminister/v2`. Before deploying it to a bucket with v1 data, enable object versioning, take a separate backup, and pause writes from all running application instances.

Run the migration tool without flags to inspect the source and planned object counts:

```sh
npm run storage:migrate-v1-v2
```

After reviewing the output, apply the migration:

```sh
npm run storage:migrate-v1-v2 -- --apply
```

The tool restores the latest v1 record from its event when needed, writes v2 JSON objects and indexes, compacts activity events, verifies the new objects, preserves service principals and their scoped keys, and skips existing v1 invitations. Active old Owners/Admins become catalog managers and keep those roles on every existing product. Old Members become product Members only where product grants exist; their grants and statuses are preserved. Invite those people again with product-scoped invitations. Keep `perminister/v1` read-only as the rollback copy.

To rebuild lookup and activity indexes from v2 canonical objects, run a dry run first and then apply:

```sh
npm run storage:rebuild-v2-indexes
npm run storage:rebuild-v2-indexes -- --apply
```

## Operational limits

Mutations are serialized only within one Node.js process. Multiple Vercel instances can race on registration, product IDs, invitations, membership limits, and writes; Spaces is not a distributed lock or transaction coordinator. Object versioning and a separate backup are required for recovery. See the [operations guide](docs/api.md) for coordination and migration details.
