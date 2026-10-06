# Authodox

Authodox is a standalone, product-neutral identity and access service for consumer applications. It centralizes human identities, credentials, shared sign-in checks, product/resource permissions, and API-key lifecycle. Each consumer application keeps its own entry point, app session, domain data, and resource enforcement.

## Current direction

- DigitalOcean Spaces is the only persistent store for Authodox.
- Authodox owns identities, credentials, product/resource-scoped grants, and API-key lifecycle.
- Consumer applications remain the entry points, establish their own app sessions, and enforce grants against their own resources.
- Human-session boundaries, app caching, and the maximum permission/key refresh delay are still to be decided.
- A consumer application that already uses private Spaces event history could be a practical first integration.

See [the v1 contract](docs/v1-contract.md) for the inventory, design direction, and unresolved decisions.

## First implementation slice

This repository now has a minimal Next.js/TypeScript service, a liveness endpoint at `/api/health`, Authodox identity and permission types, and a server-only DigitalOcean Spaces adapter for versioned record objects and append-only-by-convention event objects. No sign-in, account-linking, permission-query, or API-key lifecycle routes are implemented yet.

Copy `.env.example` to `.env.local`. The non-secret example values target the existing private `authodox` Space in `sfo3` at `https://sfo3.digitaloceanspaces.com`; add the Space access key and secret in `.env.local`. Credentials are read only by server code; do not add a `NEXT_PUBLIC_` prefix. Run `npm install` and `npm run dev` for local development. The health endpoint checks only that the Next.js process responds; it does not check Spaces readiness.

The storage and mutation boundary, object layout, and recovery limits are documented in [the v1 contract](docs/v1-contract.md). Authodox has no database or local-storage fallback.
