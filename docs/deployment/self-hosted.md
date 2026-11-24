# Self-hosted Perminister

Self-hosted Perminister is an independent deployment. It runs in the customer's network and uses
customer-managed storage, ingress, secrets, identity provider, and mail relay. The current hosted
Vercel/Railway deployment remains on its existing configuration: `PERMINISTER_STORAGE_BACKEND`
defaults to `spaces`, and the self-hosted runtime is enabled only by setting
`PERMINISTER_DEPLOYMENT_PROFILE=self-hosted` on this deployment. Do not share a writable object
bucket or PostgreSQL database between hosted and self-hosted installations.

## Deployment choices

| Storage | Compose profile | Helm | App replicas | Suitable network |
| --- | --- | --- | --- | --- |
| PostgreSQL | `compose.yaml` | `storageBackend=postgres` | One or more | Restricted egress or air-gapped |
| DigitalOcean Spaces | `compose.s3.yaml` | `storageBackend=spaces` | One writer | Egress to Spaces endpoint |
| Customer S3-compatible storage | `compose.s3.yaml` | `storageBackend=s3` | One writer | Restricted egress or air-gapped |

PostgreSQL is recommended for a clustered installation. The application coordinates changes and
rate limits through PostgreSQL advisory locks and atomic database updates. Spaces and generic S3
store the current JSON object layout; because `PutObject` is not a compare-and-swap operation, run
exactly one Perminister writer for each bucket. The Helm chart rejects multiple replicas for either
object-storage backend. The Compose examples run one app instance.

Google sign-in and Resend delivery are optional hosted integrations. For on-prem installations,
configure the built-in OIDC login with the customer's identity provider and SMTP with an internal
mail relay. Both can be omitted: local password accounts still work, but email verification,
recovery, and invitation messages will be unavailable without mail. An air-gapped install can use
internal DNS and HTTPS for OIDC and SMTP. Website lookup is an optional convenience and requires
network access to the target website; admins can enter product details manually when that access is
blocked.

## Prerequisites

- Docker Engine with Docker Compose v2 for Compose installs, or Kubernetes and Helm for cluster
  installs.
- A DNS name and TLS certificate for the Perminister public origin. Terminate TLS at the customer's
  ingress or reverse proxy and forward HTTP to port 3000 on the app network.
- A PostgreSQL database (the Postgres Compose file includes one), or an S3-compatible bucket with
  private access and Get/List/Put/Delete permissions.
- A mail relay and OIDC provider reachable from the app if email and federated login are required.
- A cryptographically random `PERMINISTER_IDENTITY_INDEX_SECRET` and a stable
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. The helper below generates both.
- For image builds from source: network access to fetch pinned Node and package dependencies. For an
  air-gapped installation, use the release image archive and transfer it into the customer network.

Use `PERMINISTER_PUBLIC_ORIGIN=https://perminister.example.com` as the canonical browser URL,
without a path or trailing slash. Set `PERMINISTER_OIDC_ISSUER` to that same HTTPS origin; this is
Perminister's own issuer URL and is separate from `PERMINISTER_LOGIN_OIDC_ISSUER`, which names the
optional external login provider. Register the exact Sentry8 redirect URI with Perminister's client
configuration. Make the CA that signs internal ingress or IdP certificates trusted by browsers,
Sentry8, and the app container. For a private CA, use the Compose CA override below or mount a
ConfigMap/Secret into the Helm pod and set `NODE_EXTRA_CA_CERTS` to its path.

## Install with Docker Compose and PostgreSQL

From a checked-out Perminister release:

```sh
node scripts/initialize-self-hosted-env.mjs postgres
```

This creates `deploy/self-hosted/.env.postgres` with generated database, identity-index, and Next.js
Server Action keys. The file is mode `0600` and ignored by Git. Edit the new file and set:

- `PERMINISTER_PUBLIC_ORIGIN` and `PERMINISTER_OIDC_ISSUER` to the canonical HTTPS origin.
- `PERMINISTER_ADMIN_EMAILS` to a comma-separated list of initial administrator email addresses.
- `PERMINISTER_OPERATOR_NAME` and `PERMINISTER_PRIVACY_EMAIL` to identify the installation operator
  on its privacy page. Both are optional; without them the page describes the operator generically.
- `PERMINISTER_MAIL_FROM`, `PERMINISTER_SMTP_URL`, and `PERMINISTER_SMTP_REQUIRE_TLS` for the internal
  relay. URL-encode special characters in SMTP usernames and passwords. Use `smtps://` for implicit
  TLS or `smtp://` for STARTTLS on a relay that requires it.
- The optional `PERMINISTER_LOGIN_OIDC_ISSUER`, `PERMINISTER_LOGIN_OIDC_CLIENT_ID`,
  `PERMINISTER_LOGIN_OIDC_CLIENT_SECRET`, and `PERMINISTER_LOGIN_OIDC_NAME` values. Register
  `https://perminister.example.com/auth/oidc/callback` as the IdP's callback URL.
- `PERMINISTER_BIND_PORT` if host port 3000 is already occupied. The default publishes only on
  loopback for a reverse proxy running on the same host.

Generate Perminister's OIDC signing keys once and keep the private key only in the protected
environment file or secret manager:

```sh
umask 077
node scripts/generate-oidc-signing-key.mjs >> deploy/self-hosted/.env.postgres
```

That command appends `PERMINISTER_OIDC_PRIVATE_JWK` and `PERMINISTER_OIDC_PUBLIC_JWKS`. The private
key signs Perminister tokens; the public key is served in JWKS. Back up the private key securely.
Do not generate a new key during an ordinary upgrade. For key rotation, publish old and new public
keys together, switch the private key, then remove the old public key only after its tokens and
JWKS cache have expired.

Either build the image from source:

```sh
docker build -t perminister:self-hosted .
```

Or set `PERMINISTER_IMAGE` in `.env.postgres` to a published version such as
`ghcr.io/zakaihamilton/perminister:selfhost-v0.1.0`, then pull it:

```sh
docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml pull app migrate
```

Apply the PostgreSQL schema migration, then start the app:

```sh
docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml --profile tools run --rm migrate
docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml up -d app
```

The first migration creates only Perminister's `perminister_objects`,
`perminister_rate_limits`, and migration-history tables. The migration runner takes a PostgreSQL
advisory lock and records applied migration filenames. Compose does not import data from the hosted
deployment.

For an internal database, identity-provider, mail, or S3 certificate authority, place the CA PEM
file on the host with read access for Docker and run Compose with the CA override:

```sh
PERMINISTER_CA_CERT_FILE=/etc/perminister/customer-ca.pem docker compose \
  --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml -f deploy/self-hosted/compose.ca.yaml \
  --profile tools run --rm migrate
PERMINISTER_CA_CERT_FILE=/etc/perminister/customer-ca.pem docker compose \
  --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml -f deploy/self-hosted/compose.ca.yaml up -d app
```

## Install with Docker Compose and S3-compatible storage

Create the S3 profile file and edit its endpoint, bucket, region, credentials, origin, admin list,
SMTP settings, and optional OIDC settings:

```sh
node scripts/initialize-self-hosted-env.mjs s3
```

For DigitalOcean Spaces, set `PERMINISTER_STORAGE_BACKEND=spaces` and fill
`PERMINISTER_SPACES_ENDPOINT`, `PERMINISTER_SPACES_REGION`, `PERMINISTER_SPACES_BUCKET`,
`PERMINISTER_SPACES_ACCESS_KEY`, and `PERMINISTER_SPACES_SECRET_KEY`. The endpoint must be the
bucket's HTTPS endpoint. For another S3 service, keep `PERMINISTER_STORAGE_BACKEND=s3` and fill the
`PERMINISTER_S3_*` values. Generic S3 uses a private object ACL by default and path-style addressing
unless `PERMINISTER_S3_FORCE_PATH_STYLE=false`.

For a source build, create the image locally:

```sh
docker build -t perminister:self-hosted .
```

For a published image, set `PERMINISTER_IMAGE` in `.env.s3` to its versioned GHCR tag and pull it.
Skip the pull when using a source build. Start one app instance; no database migration is needed for
object storage:

```sh
# Run this pull only for a published registry image.
docker compose --env-file deploy/self-hosted/.env.s3 \
  -f deploy/self-hosted/compose.s3.yaml pull app
docker compose --env-file deploy/self-hosted/.env.s3 \
  -f deploy/self-hosted/compose.s3.yaml up -d app
```

For a private CA, add `-f deploy/self-hosted/compose.s3.ca.yaml` and prefix the command with
`PERMINISTER_CA_CERT_FILE=/path/to/customer-ca.pem`.

Keep this deployment at one replica. If its bucket has a name that the hosted runtime classifies as
production, the explicit self-hosted profile still makes it writable unless
`PERMINISTER_STORAGE_READ_ONLY=true` is set.

## Install on Kubernetes with Helm

Provision PostgreSQL or S3 separately. Create a Kubernetes Secret before installing the chart; the
secret must include the selected storage values, `PERMINISTER_IDENTITY_INDEX_SECRET`,
`PERMINISTER_PUBLIC_ORIGIN`, `PERMINISTER_OIDC_ISSUER`, `PERMINISTER_ADMIN_EMAILS`,
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, any SMTP configuration, and both OIDC signing-key values.
For PostgreSQL it must also include `DATABASE_URL`. Do not put secret values in Helm values files or
commit Kubernetes Secret manifests.

For PostgreSQL, first edit `DATABASE_URL` in the protected env file to use the database's Kubernetes
service DNS name, credentials, and TLS settings. The generated Compose URL uses `@db`, which only
resolves inside the Compose network. Then create a namespace and Secret:

```sh
kubectl create namespace perminister
kubectl -n perminister create secret generic perminister-config \
  --from-env-file=deploy/self-hosted/.env.postgres
helm upgrade --install perminister charts/perminister \
  --namespace perminister --set storageBackend=postgres
```

The chart runs the migration as a pre-install and pre-upgrade Job. Set `image.repository` and
`image.tag` to the versioned image. PostgreSQL supports multiple replicas; set `replicaCount` only
after sizing the database pool for the number of app pods. Keep
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` identical on every replica and across builds.

For S3 or Spaces, create the config Secret from `.env.s3`, select the matching `storageBackend`, and
disable PostgreSQL migrations:

```sh
kubectl -n perminister create secret generic perminister-config \
  --from-env-file=deploy/self-hosted/.env.s3
helm upgrade --install perminister charts/perminister \
  --namespace perminister --set storageBackend=s3 --set migrations.enabled=false
```

Use `storageBackend=spaces` for DigitalOcean Spaces. Keep `replicaCount: 1` for both object-storage
profiles. Enable and configure the chart ingress with your ingress controller and TLS secret, or
route an existing reverse proxy to the chart's ClusterIP Service. The app listens on port 3000.
Readiness uses `/api/ready` to check storage access and required database migrations. Liveness uses
`/api/live` to check that the app process is responding.

For a private CA, create a Secret or ConfigMap and add it to a Helm values file:

```yaml
extraVolumes:
  - name: customer-ca
    secret:
      secretName: perminister-ca
extraVolumeMounts:
  - name: customer-ca
    mountPath: /run/certs/customer-ca.pem
    subPath: ca.pem
    readOnly: true
```

Set `NODE_EXTRA_CA_CERTS=/run/certs/customer-ca.pem` in the config Secret. The app and PostgreSQL
migration Job both read that optional setting.

## First administrator and Sentry8

Register the initial operator in `PERMINISTER_ADMIN_EMAILS` before the first sign-in. Create the
account at `/register` using a local password and verify its email through the configured SMTP
relay, or sign in through the configured OIDC provider with an IdP-verified matching email. The
administrator role is granted to a verified account whose email matches the configured list. Keep
at least one administrator email in that list and protect it as deployment configuration.

From the Sentry8 network, verify that the canonical origin resolves and that
`https://perminister.example.com/.well-known/openid-configuration` returns Perminister's issuer,
authorization, token, and JWKS endpoints. Register Sentry8 as an application client in Perminister
with Sentry8's exact callback URL and required scopes. Configure Sentry8 to use that origin as its
OIDC issuer. Sentry8 and the user's browser must both be able to reach the on-prem HTTPS origin; the
browser completes authorization at `/oauth/authorize`, while Sentry8 exchanges the returned code at
`/oauth/token`. The existing registration and authorization contracts are unchanged.

## Upgrades, backup, and restore

Back up the database or bucket and retain the exact image tag, chart version, environment file, and
OIDC private key before upgrading. For a registry install, change `PERMINISTER_IMAGE` to the new
version, then pull and migrate before recreating the app:

```sh
docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml pull
docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml --profile tools run --rm migrate
docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml up -d app
```

For a source build, run `docker build -t perminister:self-hosted .` before migration and skip the
`pull` command. For an air-gapped update, load the verified archive and set
`PERMINISTER_IMAGE=perminister:selfhost-vX.Y.Z`; run the migration and app commands with
`--pull never` so Compose uses the transferred image.

For Helm, update the image tag and run `helm upgrade`; the chart runs the migration before replacing
the app pods. PostgreSQL migrations are additive for this installation path. If an upgrade fails,
restore the pre-upgrade backup before rolling back a version that is incompatible with the migrated
schema.

Example PostgreSQL backup and restore for the included Compose database:

```sh
docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml exec -T db \
  pg_dump -U perminister -d perminister -Fc > perminister.dump

docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml stop app
docker compose --env-file deploy/self-hosted/.env.postgres \
  -f deploy/self-hosted/compose.yaml exec -T db \
  pg_restore --clean --if-exists --no-owner -U perminister -d perminister < perminister.dump
```

For managed PostgreSQL, use the customer's standard `pg_dump`/`pg_restore` workflow and include
Perminister's migration-history table. For S3 or Spaces, enable private bucket versioning and
customer-controlled backup retention. Back up the complete Perminister bucket/prefix with the
provider's S3-compatible backup tool. Stop the app before restoring objects, and test restore in an
isolated bucket before using it for recovery.

## Restricted-egress and air-gapped installs

The `release-self-hosted.yml` workflow runs only for `selfhost-v*` tags. It builds a versioned,
multi-architecture image in GitHub Container Registry and attaches amd64 and arm64 offline image
archives, a Helm chart, and SHA-256 checksums to the self-hosted GitHub release. It does not run in
the Railway deployment workflow.

On a connected staging machine, download the release archive for the target architecture and the
matching Helm chart if needed. Transfer those files into the customer network, verify their
checksums, and import the image:

```sh
sha256sum -c SHA256SUMS
docker load --input perminister-selfhost-v0.1.0-linux-amd64.tar.gz
```

Set `PERMINISTER_IMAGE=perminister:selfhost-v0.1.0` in the protected Compose env file, then run the
install commands without `pull`. For Kubernetes, preload the matching architecture archive on
every eligible node or import it into the customer's private registry, set
`image.pullPolicy=IfNotPresent`, and point `image.repository` and `image.tag` at the imported image.
The PostgreSQL migration Job runs from that imported image before the app starts. Example using the
release chart archive:

```sh
helm upgrade --install perminister perminister-0.1.0.tgz \
  --namespace perminister --set storageBackend=postgres \
  --set image.repository=perminister --set image.tag=selfhost-v0.1.0 \
  --set image.pullPolicy=IfNotPresent
```

Restrict outbound traffic to the customer's database, S3 service, identity provider, and SMTP relay.
No runtime connection to Vercel, Railway, Google, or Resend is required for local password and
internal OIDC/SMTP operation.
