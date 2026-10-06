# Perminister

Perminister is a product-neutral identity and access service. It owns central identities, password credentials, human sessions, scoped permission grants, and API keys. Consumer applications keep their own branded portals, app-local sessions, domain data, and resource enforcement. Perminister does not automatically merge existing application accounts by email.

## Implemented flows

- Email/password registration, sign-in, sign-out, profile, 12-hour sessions, session revocation, email verification, and password recovery.
- Administrator identity directory, account enable/disable, and product/project/workspace-scoped permission grants.
- API-key creation, one-time secret display, rotation, expiry, listing, revocation, and audit history.
- `GET /api/auth/session` for the current browser session and `POST /api/authorize` for server-to-server bearer-key checks.
- S3-only versioned record snapshots and append-only-by-convention events, with per-record snapshot repair from the latest event.

See [the API and operations guide](docs/api.md) for payloads, setup, security boundaries, Resend configuration, and recovery behavior. The [v1 contract](docs/v1-contract.md) retains the anonymized account inventory and storage design.

## Local setup

Copy `.env.example` to `.env.local`, then add the DigitalOcean Spaces access key and secret key through a secure local editor. Keep both server-side; never use a `NEXT_PUBLIC_` prefix. The bucket endpoint, region, and bucket are set to `https://perminister.sfo3.digitaloceanspaces.com`, `sfo3`, and `perminister`. The credential fields in `.env.example` are blank.

Set `PERMINISTER_ADMIN_EMAILS` to the email address that should administer the identity directory and permission grants. That account must register and verify ownership of the same address before administrator controls become available. For local email links, `PERMINISTER_PUBLIC_ORIGIN` defaults to `http://localhost:3000`.

Email verification and password recovery send through Resend's email API. They stay unavailable until `RESEND_API_KEY`, `PERMINISTER_MAIL_FROM`, and `PERMINISTER_PUBLIC_ORIGIN` are configured. Use a sender address from a verified Resend domain. The API contract is documented in [docs/api.md](docs/api.md); when configuration is missing or Resend rejects a message, the UI says no email was sent.

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

## Storage and deployment

DigitalOcean Spaces is the only persistent store. There is no database or local-storage fallback. Mutations are serialized by a process-local queue. The operating assumption is low-volume administration with changes issued one at a time; enable Spaces object versioning and keep a separate backup before production writes.

Vercel can serve the Next.js application. Standard Vercel Functions can run across instances, and the process-local queue does not serialize writes globally. Sequential administrator actions are the accepted low-volume operating assumption; cross-instance write races remain a residual risk. Vercel environment names and values are listed in [docs/api.md](docs/api.md); Spaces credentials are required for persistent operations.
