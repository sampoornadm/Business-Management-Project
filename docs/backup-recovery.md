# Backup & Recovery

## Scope

**Postgres only.** The database holds every piece of structured data in the system (tenders, BOQs,
procurement, projects, finance, audit log) and is the only store where data loss is irreversible
without a backup. Uploaded files (attachments, BOQ documents) live in S3-compatible object storage
(MinIO in dev, AWS S3 or equivalent in production) — object storage backup/versioning is the
deployer's responsibility via their storage provider's own tooling (e.g. S3 versioning + cross-region
replication), not duplicated here. Redis holds only ephemeral state (sessions, rate-limit counters,
the RBAC permission cache, BullMQ job queues) that is safe to lose and rebuilds itself from Postgres
and normal usage — it is intentionally not backed up.

## What gets backed up

A full `pg_dump` of the application database (schema + data), gzip-compressed, in plain SQL format
(`pg_dump | gzip`, not the custom/directory format) — restorable with `psql` alone, no extra tooling.

## How to back up

```bash
infra/scripts/backup-db.sh [output-dir]
```

- Defaults to writing into `./backups/` at the repo root if no directory is given.
- Detects whether the `postgres` service is running under `docker compose` and uses
  `docker compose exec` automatically; falls back to a bare `pg_dump` on `PATH` against
  `POSTGRES_HOST`/`POSTGRES_PORT` otherwise (e.g. a managed Postgres instance).
- Reads `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` from `.env` (or the calling shell's
  environment, which takes precedence over `.env`).
- Prunes dumps older than `BACKUP_RETENTION_DAYS` (default 14) after each run.
- Output filename: `<POSTGRES_DB>-<UTC timestamp>.sql.gz`.

### Scheduling

Two options, pick one:

1. **Host cron** (simplest): add a crontab entry that calls the script on the schedule you want,
   e.g. daily at 02:00: `0 2 * * * cd /path/to/repo && ./infra/scripts/backup-db.sh >> /var/log/bmp-backup.log 2>&1`
2. **The opt-in `db-backup` Compose service**: `docker compose --profile backup up -d db-backup`
   runs the same `pg_dump` command in a loop (`BACKUP_INTERVAL_SECONDS`, default 86400 = daily),
   writing into a `./backups` bind mount. It is **not** started by a plain `docker compose up` —
   backups are an explicit opt-in, not a silent default that could surprise you with unexpected
   disk usage.

Either way, ship the resulting `.sql.gz` files off the host (S3, another server, etc.) — a backup
that lives only on the same disk as the database it backs up does not protect against disk/host
failure.

## How to restore

```bash
infra/scripts/restore-db.sh <path-to-dump.sql.gz> [--yes]
```

- **Destructive**: restores INTO the database named by `POSTGRES_DB` (or a `POSTGRES_DB` override
  you export beforehand), overwriting whatever is there. Without `--yes`, it prompts you to type
  the target database name to confirm.
- Runs inside `--single-transaction --set ON_ERROR_STOP=on`: if anything in the dump fails to
  apply, the whole restore rolls back atomically — you're never left with a half-restored database.
- Same `docker compose exec` vs. bare `psql` auto-detection as the backup script.

To restore into a **different** database (e.g. to inspect a backup without touching the live one):

```bash
POSTGRES_DB=bmp_restore_check ./infra/scripts/restore-db.sh backups/bmp-20260101T000000Z.sql.gz --yes
```

(Create the target database first — `psql -U bmp -d postgres -c "CREATE DATABASE bmp_restore_check OWNER bmp;"`.)

## RPO / RTO for a system this size

- **RPO (Recovery Point Objective)**: bounded by your backup schedule. Daily backups mean up to 24
  hours of data loss in the worst case. If that's too coarse once real usage volume grows, increase
  the schedule frequency (e.g. every 6 hours) — the script and its retention pruning scale to that
  without changes.
- **RTO (Recovery Time Objective)**: dominated by `pg_dump`/`psql` runtime, which scales with
  database size. For the data volumes this ERP produces (tenders/BOQ/procurement/finance records,
  not bulk binary data — those live in S3), a restore should complete in well under a minute even
  with years of accumulated data; verify this assumption periodically by timing a real restore into
  a scratch database as the dataset grows.

## Verifying a backup is actually restorable

Don't trust a backup you've never restored. Periodically:

```bash
psql -U bmp -d postgres -c "CREATE DATABASE bmp_restore_check OWNER bmp;"
POSTGRES_DB=bmp_restore_check ./infra/scripts/restore-db.sh backups/<latest>.sql.gz --yes
psql -U bmp -d bmp_restore_check -c "SELECT count(*) FROM tenders;"   # compare against the live count
psql -U bmp -d postgres -c "DROP DATABASE bmp_restore_check;"
```
