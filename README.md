# Perminister

Perminister gives organizations a shared place to manage product teams and access. Consumer
applications keep their own branded experiences, sessions, domain data, and resource enforcement.

## Product capabilities

- Shared email/password identity, app-bound sessions, email verification, and password recovery.
- Organization and product catalogs, invitations, team membership, and scoped permission grants.
- Server-side authorization checks for product, project, and workspace actions.
- User API keys and service integrations with scoped, revocable credentials.

See the [application integration API](docs/api.md) for the consumer authentication, authorization,
and service integration contract.

## Local development

Running the Perminister service requires platform-provisioned server settings. Contact a platform
operator for a local environment file. Application integrators only need the
[application integration API](docs/api.md); keep client credentials out of browser code and logs.

    npm install
    npm run dev

## Production storage topology

Vercel serves reads directly from DigitalOcean Spaces with a read-only Spaces key. It sends every
mutation, including Next.js Server Actions and API writes, through its Functions to the Railway
writer. Railway is the only service with write-capable Spaces credentials. This keeps the
process-local mutation queue and recovery throttles behind one writer; Spaces `PutObject` does not
provide the conditional writes needed to coordinate independent writers.

Configure the Railway service with one replica in one region and set its deployment overlap to zero.
The [`deploy-railway.yml`](.github/workflows/deploy-railway.yml)
workflow uploads every push to `main` to the configured Railway production service. See
[`docs/deployment/railway.md`](docs/deployment/railway.md) for service settings, shared secrets, and
the Vercel-to-Railway mutation proxy setup.

Local `npm run dev` continues to use its configured local storage. Set
`PERMINISTER_WRITE_PROXY_URL` and `PERMINISTER_WRITE_PROXY_SECRET` in `.env.local` to send local
mutations through Railway too. Without those settings, use a separate development bucket so the
local process does not write to the production bucket.
