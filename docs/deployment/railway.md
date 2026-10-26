# Railway deployment

The `Deploy to Railway` GitHub Actions workflow deploys changes to the writer, its API, shared
backend code, or runtime dependencies from `main` to the selected Railway service. Dashboard and
other presentation-only changes do not trigger a Railway build. It also supports manual runs from
the Actions tab.

## One-time GitHub setup

Create a Railway project token scoped to the production environment, then configure these values in
the GitHub repository settings under **Settings → Secrets and variables → Actions**:

| Name                     | GitHub setting | Value                                    |
| ------------------------ | -------------- | ---------------------------------------- |
| `RAILWAY_TOKEN`          | Secret         | The Railway project token for production |
| `RAILWAY_PROJECT_ID`     | Variable       | The Railway project ID                   |
| `RAILWAY_ENVIRONMENT_ID` | Variable       | The production environment ID            |
| `RAILWAY_SERVICE_ID`     | Variable       | The Perminister service ID               |

The Railway project, production environment, and Perminister service must exist before the first
workflow run.

The project token is scoped to its Railway environment and is used only by the deploy step. The
workflow installs Railway CLI `5.63.4`, sets `NEXT_DEPLOYMENT_ID` to the checked-out commit SHA,
and uploads that commit with `railway up`. Its path filter mirrors the writer inputs hashed by
`next.config.ts`; update both when adding a new writer entry point or changing the writer build.

## Railway service settings

- Set the build command to `pnpm run build` and the start command to `pnpm run start`. This keeps
  Railway on the repository's pinned package manager and avoids npm warnings for pnpm-only config.
- Let this workflow be the service's only automatic deploy source. Set Railway Watch Paths to a
  reserved path that is absent from this repository, such as `/.railway-cli-only/**`, so Railway's
  GitHub source does not create a second deployment for each push. Before `railway up`, this
  workflow writes a per-run marker under that path in its temporary checkout. Railway sees that
  marker in the CLI upload and deploys the writer, while the marker never enters Git history. This
  workflow path-filters writer changes so dashboard-only edits do not deploy the writer.
- Set the service to one replica in one region.
- Set the deployment overlap to `0` so an old writer cannot overlap the new writer during deploys.
- Set `PERMINISTER_WRITER_MODE=true`.
- Configure the service variables from `.env.example` in Railway. Keep credentials and secrets out
  of this repository.
- Set the deployment health check path to `/api/ready` after the Spaces variables are configured.

## Vercel read and Railway write split

Vercel serves `GET` and `HEAD` requests from its Next.js deployment, which reads auth records from
Spaces. Mutations use stable, same-origin `POST` routes such as `/login/submit`, `/logout/submit`,
and `/actions/<action-name>`; Vercel proxies them to Railway. These form endpoints do not depend on
build-specific Next.js Server Action IDs. The Railway service accepts writes only from requests
carrying the shared internal secret and rejects other application routes when accessed directly.

Configure these values in **both** Vercel Production and Railway:

| Name                             | Vercel Production                    | Railway                              |
| -------------------------------- | ------------------------------------ | ------------------------------------ |
| `PERMINISTER_WRITE_PROXY_SECRET` | Same random value, at least 32 bytes | Same random value, at least 32 bytes |

Generate the proxy secret once and enter it in both services. For example, `openssl rand -hex 32`
makes a suitable value. Never commit it.

The Railway workflow updates `NEXT_DEPLOYMENT_ID` to the commit SHA before each deploy. Vercel uses
`VERCEL_GIT_COMMIT_SHA` as its deployment ID. Separately, `next.config.ts` computes a writer revision
from the API routes, mutation handlers, shared `src/lib` code, proxy, and runtime dependency files.
Vercel and Railway can therefore run different dashboard commits while agreeing on the writer code
they share. The Vercel `/api/ready` endpoint verifies that Railway accepts the shared write-proxy
secret and reports not-ready while either the secret or writer revisions differ. The write proxy
returns a refresh response for a stale page or a temporary error while the writer is deploying.
This prevents writes from crossing writer revisions during rollout. Keep both services on the same
writer revision and configure the same proxy secret before enabling production mutations.

In Vercel Production, also set:

| Name                          | Value                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `PERMINISTER_WRITE_PROXY_URL` | The Railway service's HTTPS public origin, such as `https://perminister-production.up.railway.app` |

Configure the same `PERMINISTER_SPACES_ENDPOINT`, `PERMINISTER_SPACES_REGION`, and
`PERMINISTER_SPACES_BUCKET` in both environments. `PERMINISTER_IDENTITY_INDEX_SECRET` must also
match exactly between Vercel and Railway; changing it requires rebuilding the identity indexes.
Use a Spaces key with **Read** permission in Vercel and a key with **Read/Write/Delete** permission
in Railway. DigitalOcean supports per-bucket limited-access keys; see
[Managing Spaces access](https://docs.digitalocean.com/products/spaces/how-to/manage-access/).

After deploying the organization membership index code, rebuild the bucket indexes from the Railway
writer environment. Run `node scripts/rebuild-spaces-indexes.mjs` once to review the dry-run counts,
then run `node scripts/rebuild-spaces-indexes.mjs --apply`. The script writes the membership-index
manifest only after all index objects have been written. Until that manifest exists, organization-wide
membership reads use the legacy scan; product and catalog-manager reads already use their narrower
Spaces prefixes. New membership writes maintain the index automatically.

Server logs include structured `perminister.request.performance` events for API routes and the
organization dashboard access and navigation reads. Each event records route, status, total duration,
and Spaces call counts and time by operation. Aggregate `durationMs` from these events to compare
route latency percentiles before and after a deployment.

The proxy is enabled for Vercel Production; Preview deployments reject mutations. Reads from Vercel
remain available when the proxy is down; writes return `502` or `503` rather than falling back to a
Vercel process. Railway readiness returns `503` if its shared proxy secret is missing.

Local `pnpm run dev` works without proxy variables and handles mutations locally as before. To send
local mutations to Railway, set `PERMINISTER_WRITE_PROXY_URL` and the shared
`PERMINISTER_WRITE_PROXY_SECRET` in `.env.local`. Local proxy URLs can use HTTPS Railway domains or
an HTTP loopback address for a local writer; hosted Vercel deployments require HTTPS. If local
reads use the production bucket, use a read-only Spaces key locally too. Without the proxy
settings, point local development at a separate bucket with its own read/write key.

Perminister stores auth records in DigitalOcean Spaces, and its mutation queue is process-local.
Only one Railway process may write to a given bucket. Vercel instances can scale for reads when
configured with read-only Spaces credentials. Keep Railway at one replica and prevent overlapping
old and new writer processes during deploys.

Deploy and configure Railway first, then configure and redeploy Vercel Production. Do not direct
production mutation traffic to Railway until its writer secret, Spaces credentials, and health
check are ready.

The workflow intentionally targets one explicit Railway project, environment, and service. If any
GitHub variable or the token is missing, deployment fails with a message naming the missing setting.
