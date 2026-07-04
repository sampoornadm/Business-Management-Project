# Production Deployment

This covers deploying BMP beyond `docker compose up -d` on a laptop — a single server (or a small
fleet) running the same Docker Compose stack the repo already defines, fronted by TLS.

See [`environment-variables.md`](./environment-variables.md) for what every variable means and
[`backup-recovery.md`](./backup-recovery.md) for backing up the database once it's live.

## Architecture recap

`docker-compose.yml` defines: `postgres`, `redis`, `minio` (swap for real S3 in production — see
below), `server` (Express API), `worker` (BullMQ email/reminder jobs, same image as `server`),
`web` (Next.js, standalone output), and `nginx` (reverse proxy). Everything is stateless except
Postgres/Redis/MinIO, which use named volumes.

## 1. Provision the host

Any host that can run Docker + Docker Compose v2 (a single VM is plenty at this system's scale —
nothing here requires Kubernetes). Open inbound `80`/`443` only; every other service
(`postgres`/`redis`/`minio`/`server`/`web`) should stay behind the reverse proxy, not exposed
directly to the internet — don't publish their ports on a public interface.

## 2. Configure environment

Copy `.env.example` to `.env` on the host and fill in **real, unique, rotated** values for every
variable marked "Sensitive" in [`environment-variables.md`](./environment-variables.md). Do not
commit this file; keep it out of version control and manage it the same way you manage any other
production secret (a password manager, your host provider's secret store, etc.).

Key production-specific changes from the dev defaults:

- `CORS_ORIGIN` and `WEB_APP_URL` → your real public HTTPS origin (e.g. `https://bmp.example.com`).
- `NEXT_PUBLIC_API_URL` → the public API path through your reverse proxy (e.g.
  `https://bmp.example.com/api/v1`) — this is baked into the web bundle at build time, so changing
  it later requires rebuilding the `web` image, not just restarting the container.
- Either keep MinIO (fine at this scale) or point `S3_*` at a real AWS S3 bucket and set
  `S3_FORCE_PATH_STYLE=false`.
- Point `SMTP_*` at a real transactional email provider instead of Mailhog.
- Do **not** set `SEED_USER_PASSWORD` / run `pnpm db:seed` against production — seeding creates
  demo users with a known password and is for local dev/CI fixtures only.

## 3. Build and start the stack

```bash
docker compose build
docker compose up -d postgres redis minio minio-init mailhog server worker web nginx
```

(Omit `mailhog` once a real SMTP provider is configured — it's a dev-only fake mail catcher.)

Run migrations once the database is up:

```bash
docker compose exec server sh -c "cd packages/database && npx prisma migrate deploy"
```

Then create your first real admin user — either via a one-off script, or by temporarily setting
`SEED_USER_PASSWORD` and running the seed **once** against a fresh database before any real data
exists, then rotating every seeded account's password immediately afterward.

## 4. TLS

The bundled `infra/docker/nginx/default.conf` is HTTP-only — fine for local dev, not for production.
The simplest path is Certbot's standalone/webroot mode terminating TLS at the same nginx container.
Example (adapt the domain and cert paths):

```nginx
server {
    listen 80;
    server_name bmp.example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name bmp.example.com;

    ssl_certificate     /etc/letsencrypt/live/bmp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bmp.example.com/privkey.pem;

    client_max_body_size 25m;

    location /api/ {
        proxy_pass http://bmp_server;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $request_id;
    }

    location / {
        proxy_pass http://bmp_web;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Keep the `upstream bmp_web`/`upstream bmp_server` blocks from the existing config; only the
`server {}` blocks change. Mount the Certbot webroot and `/etc/letsencrypt` as volumes on the
`nginx` service, and run Certbot's renewal on a cron/systemd timer (standard Certbot setup, not
specific to this project).

## 5. Zero-downtime redeploys

Since `server`/`worker`/`web` are stateless, redeploy one service at a time without touching the
others:

```bash
git pull
docker compose build server
docker compose up -d --no-deps server
docker compose build worker && docker compose up -d --no-deps worker
docker compose build web && docker compose up -d --no-deps web
```

Run `prisma migrate deploy` (step 3) before restarting `server`/`worker` if the pull included a new
migration — migrations are additive-by-convention in this codebase (see `CLAUDE.md`'s RBAC/seed
notes), so this is safe to run before the new code is live.

## 6. Scaling

- `server` and `web` are stateless — run multiple replicas behind nginx (or a real load balancer)
  if throughput requires it; no code changes needed.
- `worker` can also run multiple replicas — BullMQ handles concurrent workers pulling from the same
  Redis-backed queues safely.
- Postgres and Redis are the only stateful pieces; scale those the way you'd scale any Postgres/
  Redis deployment (read replicas, managed Redis, etc.) if this ever outgrows a single instance —
  nothing here assumes a single-node database.

## 7. Monitoring & health checks

- `GET /api/v1/health/live` — liveness (process is up, no dependency checks). Use for container
  restart policies / orchestrator liveness probes.
- `GET /api/v1/health/ready` — readiness (Postgres, Redis, S3, and the BullMQ queue connection all
  checked in parallel). Use for load-balancer health checks / readiness probes. `GET
  /api/v1/health` is a backward-compatible alias for `/ready`.
- `GET /metrics` (no `/api/v1` prefix, no auth — standard Prometheus convention) — process metrics
  plus an `http_request_duration_seconds` histogram labeled by method/route/status. Point a
  Prometheus instance at it if you run one; nothing here requires a specific monitoring vendor.
- Logs are structured JSON (Pino) in production, already redacting secrets
  (`authorization`/`cookie`/`password`/etc. — see `apps/server/src/shared/logger/logger.ts`) — pipe
  container stdout into whatever log aggregator you use (CloudWatch, Loki, ELK, or just `docker
  compose logs`); no code changes needed since the JSON is already structured for that.

## Known follow-up

`pnpm audit` currently reports high/critical findings in `nodemailer` and `vitest` that require
major-version bumps — deliberately not bumped in this pass (see the Phase 8 plan's "Known
follow-up" section for why). Triage and upgrade these with real regression testing before treating
the `dependency-audit` CI job as a hard release gate.
