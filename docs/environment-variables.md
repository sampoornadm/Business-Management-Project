# Environment Variables Reference

Every variable below lives in `.env` at the repo root (copy `.env.example` to start).
`docker-compose.yml`, the server, and the web app all read from this one file in local dev; in
production, inject the same names via your host/orchestrator's secret/config mechanism instead of
committing a `.env` file (see [`deployment.md`](./deployment.md)).

**Sensitive** = must be a strong, unique, rotated-per-environment value in production, never the
dev placeholder committed in `.env.example`.

## Postgres

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `POSTGRES_USER` | Yes | No | Also used by `infra/scripts/backup-db.sh`/`restore-db.sh`. |
| `POSTGRES_PASSWORD` | Yes | **Yes** | |
| `POSTGRES_DB` | Yes | No | |
| `POSTGRES_PORT` | No (default `5432`) | No | Host-side port mapping only; irrelevant if Postgres is a managed service. |
| `DATABASE_URL` | Yes | **Yes** | Prisma connection string. Must match the four vars above when using the bundled `docker-compose` Postgres. |

## Redis

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `REDIS_PORT` | No (default `6379`) | No | Host-side port mapping only. |
| `REDIS_URL` | Yes | No* | *Mark sensitive if your Redis requires auth (`redis://:password@host:port`) — the bundled dev Redis has none. Used for sessions/rate-limiting/caching and as the BullMQ connection. |

## Object storage (S3-compatible / MinIO)

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `MINIO_ROOT_USER` | Dev only | **Yes** | Only relevant when running the bundled MinIO container. |
| `MINIO_ROOT_PASSWORD` | Dev only | **Yes** | |
| `MINIO_PORT` / `MINIO_CONSOLE_PORT` | No | No | Host-side port mappings only. |
| `S3_ENDPOINT` | Yes | No | Point at AWS S3 or any S3-compatible provider in production. |
| `S3_REGION` | Yes | No | |
| `S3_ACCESS_KEY_ID` | Yes | **Yes** | |
| `S3_SECRET_ACCESS_KEY` | Yes | **Yes** | |
| `S3_BUCKET` | Yes | No | A `<S3_BUCKET>-test` bucket must also exist for running integration tests. |
| `S3_FORCE_PATH_STYLE` | Yes | No | `true` for MinIO; set `false` for AWS S3 (virtual-hosted-style URLs). |

## SMTP (email)

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `SMTP_HOST` | Yes | No | Mailhog in dev; a real provider (SES, SendGrid, etc.) in production. |
| `SMTP_PORT` | Yes | No | |
| `SMTP_FROM` | Yes | No | Display name + address used as the `From:` header. |
| `MAILHOG_WEB_PORT` | Dev only | No | Mailhog's web UI port; irrelevant once a real SMTP provider is configured. |
| `SMTP_USER` / `SMTP_PASSWORD` | Only if your provider requires auth | **Yes** | Not read by the bundled dev Mailhog; add if your production SMTP provider needs credentials (check `apps/server/src/config/env.ts` before assuming — extend the schema there if your provider needs them). |

## Server

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `SERVER_PORT` | No (default `4000`) | No | |
| `API_BASE_PATH` | No (default `/api/v1`) | No | |
| `CORS_ORIGIN` | Yes | No | Must exactly match the web app's public origin in production (e.g. `https://app.example.com`). |
| `ACCESS_TOKEN_SECRET` | Yes | **Yes** | JWT signing secret. Generate with `openssl rand -hex 32`. Rotating it invalidates every live session. |
| `ACCESS_TOKEN_TTL_MINUTES` | No (default `15`) | No | |
| `REFRESH_TOKEN_TTL_DAYS` | No (default `30`) | No | |
| `REFRESH_TOKEN_COOKIE_NAME` | No | No | |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | No (default `60`) | No | |
| `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | No (default `48`) | No | |
| `WEB_APP_URL` | Yes | No | Used to build links in emails (invite/reset/verify). Must be the public web URL in production. |
| `SEED_USER_PASSWORD` | Dev/CI only | **Yes** | Password assigned to all seeded demo users (`pnpm db:seed`). **Never run the seed script against a production database** — it's for local dev and CI fixtures only. |
| `BACKUP_RETENTION_DAYS` | No (default `14`) | No | Read by `infra/scripts/backup-db.sh`. |

## Web (Next.js)

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | No | Baked into the client bundle at build time — must point at the API's public URL before `next build` runs in production (rebuild the image if this changes). |
| `WEB_PORT` | No (default `3000`) | No | |

## Production checklist

Before deploying anywhere beyond local dev:

1. Generate fresh, unique values for every row marked **Sensitive** above — never reuse a value
   from `.env.example`.
2. Set `S3_FORCE_PATH_STYLE=false` if using real AWS S3 (not MinIO).
3. Set `CORS_ORIGIN` and `WEB_APP_URL` to your real public web origin (both must use `https://`).
4. Do not set `NODE_ENV` yourself — `next build`/`next start` and `tsc`/`tsx` each set it correctly
   for their own step; forcing it breaks `next build` (see the comment at the top of `.env.example`).
