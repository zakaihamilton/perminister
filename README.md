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

The auth store writes records and indexes to DigitalOcean Spaces. Its mutation queue and recovery
throttles are process-local, and Spaces `PutObject` does not provide the conditional writes needed
to coordinate independent writers. Run exactly one Node.js server process against a given Spaces
bucket, including during deploys; do not use multiple replicas or overlapping old and new servers.
Horizontal scaling requires moving auth mutations to a transactional shared store first.
