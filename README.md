# Perminister

Perminister helps organizations manage their products, team access, and API keys. Each dashboard section has its own page in a shared sidebar. Members manage their own access and account; owners and admins manage organization products and invitations. Consumer applications keep their own sessions, domain data, and resource enforcement.

## Implemented flows

- Email/password registration, sign-in, sign-out, profile, 12-hour sessions, session revocation, email verification, and password recovery.
- Organization creation and switching, Owner/Admin/Member roles, email invitations, products, and product/project/workspace-scoped permission grants.
- Product setup from a website URL, with optional Brave Search name lookup and editable metadata preview.
- API-key creation, one-time secret display, rotation, expiry, listing, revocation, and audit history.
- First-party product authentication APIs for registration, verified login, product-bound sessions, password recovery/change, and organization discovery.
- Organization-scoped service principals and project/workspace API keys for server integrations.
- `GET /api/auth/session` for the Perminister browser session and `POST /api/authorize` for API-key and product-session checks.
- `GET /api/health` for process liveness and `GET /api/ready` for DigitalOcean Spaces readiness.
- S3-only versioned record snapshots and append-only-by-convention events, with per-record snapshot repair from the latest event.

See [the API and operations guide](docs/api.md) for payloads, setup, security boundaries, Resend configuration, and recovery behavior. The [v1 contract](docs/v1-contract.md) retains the anonymized account inventory and storage design.

## Local setup

Copy `.env.example` to `.env.local`, then add the DigitalOcean Spaces access key and secret key through a secure local editor. Keep both server-side; never use a `NEXT_PUBLIC_` prefix. The bucket endpoint, region, and bucket are set to `https://perminister.sfo3.digitaloceanspaces.com`, `sfo3`, and `perminister`. The credential fields in `.env.example` are blank.

Set `PERMINISTER_ADMIN_EMAILS` only for the restricted platform operations role. Customer product and access management uses organization roles. For local email links, `PERMINISTER_PUBLIC_ORIGIN` defaults to `http://localhost:3000`.

To connect a product such as Visitoring or PostParticle, add its client ID to `PERMINISTER_APP_CLIENT_IDS` and configure the matching server-only secret, display name, product ID, and optional app origin. The client secret belongs only in the product backend. See [the consumer authentication contract](docs/api.md#consumer-application-authentication) for the login, session, organization-selection, authorization, and service-integration flow.

Email verification and password recovery send through Resend's email API. They stay unavailable until `RESEND_API_KEY`, `PERMINISTER_MAIL_FROM`, and `PERMINISTER_PUBLIC_ORIGIN` are configured. Use a sender address from a verified Resend domain. The API contract is documented in [docs/api.md](docs/api.md); when configuration is missing or Resend rejects a message, the UI says no email was sent.

Organization invitations also use Resend. Website import is available without search credentials. To search product names, set `BRAVE_SEARCH_API_KEY`; search happens on the server and users review the suggested website and metadata before saving.

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

## Storage and deployment

DigitalOcean Spaces is the only persistent record store. There is no database or local-storage fallback. Mutations are serialized within each Node.js process, but that queue and the lookup and sign-in rate limits are not shared across processes. Enable Spaces object versioning and keep a separate backup before production writes.

Vercel can serve the Next.js application across multiple instances, and concurrent writes can race across those instances. Perminister detects duplicate event revisions before replaying or repairing snapshots, but cannot guarantee cross-instance uniqueness or mutual exclusion with Spaces alone. Vercel environment names and values are listed in [docs/api.md](docs/api.md); Spaces credentials are required for persistent operations.
