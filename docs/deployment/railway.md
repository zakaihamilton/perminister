# Railway deployment

The `Deploy to Railway` GitHub Actions workflow deploys each push to `main` to the selected Railway
service. It also supports manual runs from the Actions tab.

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
workflow installs Railway CLI `5.63.4` and uploads the checked-out commit with `railway up`.

## Railway service settings

- Let this workflow be the service's only automatic deploy source; disable Railway's native GitHub
  autodeploy for the same service to avoid deploying each push twice.
- Set the service to one replica in one region.
- Set the deployment overlap to `0` so an old writer cannot overlap the new writer during deploys.
- Set `PERMINISTER_WRITER_MODE=true`.
- Configure the service variables from `.env.example` in Railway. Keep credentials and secrets out
  of this repository.
- Set the deployment health check path to `/api/ready` after the Spaces variables are configured.

## Vercel read and Railway write split

Vercel serves `GET` and `HEAD` requests from its Next.js deployment, which reads auth records from
Spaces. All other methods are proxied to Railway, including Server Action `POST` requests. The
Railway service accepts writes only from requests carrying the shared internal secret and rejects
other application routes when accessed directly.

Configure these values in **both** Vercel Production and Railway:

| Name                                 | Vercel Production                            | Railway                                      |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------- |
| `PERMINISTER_WRITE_PROXY_SECRET`     | Same random value, at least 32 bytes         | Same random value, at least 32 bytes         |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Same base64-encoded key at build and runtime | Same base64-encoded key at build and runtime |

Generate each value once and enter it in both services. For example, `openssl rand -hex 32` makes
the proxy secret and `openssl rand -base64 32` makes a valid Next.js encryption key. Never commit
either value. Keep the Next.js key stable across deployments. Vercel and Railway must build the same
source revision so Server Actions rendered by Vercel are present on the Railway writer.

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

When using the legacy import API, set the same `PERMINISTER_LEGACY_IMPORT_SECRET` on Vercel and
Railway so proxied import requests are authorized by the writer.

The proxy is enabled for Vercel Production; Preview deployments reject mutations. Reads from Vercel
remain available when the proxy is down; writes return `502` or `503` rather than falling back to a
Vercel process. Railway readiness returns `503` if its shared proxy secret is missing.

Local `npm run dev` works without proxy variables and handles mutations locally as before. To send
local mutations to Railway, set `PERMINISTER_WRITE_PROXY_URL` and the shared
`PERMINISTER_WRITE_PROXY_SECRET` in `.env.local`. The local Server Action build must use the same
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` and source revision as Railway for its Server Action requests
to be accepted. Local proxy URLs can use HTTPS Railway domains or an HTTP loopback address for a
local writer; hosted Vercel deployments require HTTPS. If local reads use the production bucket,
use a read-only Spaces key locally too. Without the proxy settings, point local development at a
separate bucket with its own read/write key.

Perminister stores auth records in DigitalOcean Spaces, and its mutation queue is process-local.
Only one Railway process may write to a given bucket. Vercel instances can scale for reads when
configured with read-only Spaces credentials. Keep Railway at one replica and prevent overlapping
old and new writer processes during deploys.

Deploy and configure Railway first, then configure and redeploy Vercel Production. Do not direct
production mutation traffic to Railway until its writer secret, Spaces credentials, and health
check are ready.

The workflow intentionally targets one explicit Railway project, environment, and service. If any
GitHub variable or the token is missing, deployment fails with a message naming the missing setting.
